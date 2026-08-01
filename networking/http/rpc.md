# gRPC / Protobuf / Thrift / Avro

## TL;DR

应用层从 JSON 走到 Protobuf，再锁进 gRPC-over-HTTP/2，是过去十五年的"RPC 黄金时代"。本节从字节布局讲 protobuf varint + wire-type 编码逻辑、gRPC-over-HTTP/2 的 trailers 锁定语义、Thrift 的 binary/compact 编码、Avro schema 进字节流与 Protobuf 的 schema 漂移。最后讲产线选型：gRPC 4 模式、Conn pool 池大小、流式透传 trace_id、core cancel 时刻。

---

## 一、协议对比表

| 协议 | schema | 编码 | 传输 | 流式 | 大小 | 类型化 | 主留言 |
|------|--------|------|------|------|------|--------|--------|
| JSON | 无 | 文本 | HTTP/1.1 / 2 | chunked | 大 | 弱 | REST 默认 |
| Protobuf | `.proto` | varint + length-delim | gRPC over HTTP/2 | 是 | 小 | 强 | Google 内 ++ |
| Thrift | `.thrift` | binary / compact | TSocket/HTTP | 弱 | 中 | 强 | Facebook 仍用 |
| Avro | schema+ | 二进制 + type coded | Kafka / RPC | Weak | 小 | 强 | Hadoop 系 |
| Cap'n Proto | `.capnp` | 共享内存 zero-copy | 自带 | 是 | 中 | 强 | Sandstorm 五圣器 |
| FlatBuffers | `.fbs` | 零拷贝 | 各种 | 是 | 中 | 强 | 微信内 + Google |
| MessagePack | 无 | 紧凑 type-tag | 各种 | 否 | 中 | 中 | Reddit 等 |
| BSON | 文档 | BSON 编码 | MongoDB 内部 | 否 | 中 | 中 | Mongo 专用 |

---

## 二、Protobuf 字节布局

### 2.1 .proto 定义

```proto
syntax = "proto3";

message Person {
    int32 id = 1;
    string name = 2;
    repeated string emails = 3;
    Address address = 4;
}

message Address {
    string street = 1;
    string city = 2;
    string state = 3;
}
```

每个字段有 (1) `field_number`、(2) `wire_type`、(3) `value`。

### 2.2 Wire type

| wire type | 含义 | 用法 |
|-----------|------|------|
| 0 | varint | int32/int64/uint32/uint64/sint32/sint64/bool/enum |
| 1 | fixed64 | fixed64/sfixed64/double |
| 2 | length-delimited | string/bytes/embedded message/repeated packed |
| 5 | fixed32 | fixed32/sfixed32/float |
| 3 / 4 | group (start / end) | proto2 only, deprecated |

每字段开头为 1 个 varint，低 3 bit 是 wire_type，高位是 field_number：
```
key = (field_number << 3) | wire_type
```

### 2.3 Varint 编码

```python
def varint_encode(n):
    out = b''
    while n >= 0x80:
        out += bytes([(n & 0x7F) | 0x80])  # 头位 1 = continue
        n >>= 7
    out += bytes([n & 0x7F])
    return out
```

值 `300` 编码为 `AC 02`：
```
300 = 0b100101100
    → 低 7 bit: 0101100  → 10101100 (0xAC, 顶部 bit 1 还有)
    → 接着 7 bit: 0000010 → 00000010 (0x02)
```

### 2.4 负数用 zigzag

`int32` 负数会被强转 int64 (10 字节 varint) 浪费。`sint32` 用 zigzag：
```
0 → 0, -1 → 1, 1 → 2, -2 → 3, 2 → 4, ...
zigzag(n) = (n << 1) ^ (n >> 31)
```

`300` 变 varint `02` 即可，节省 byte。

### 2.5 完整 Person 编码

```python
# Person { id=2, name="Alice", emails=["a@x", "b@x"], address={"Main", "PDX", "OR" } }

# field 1 (id), wire_type=0
0x08                    # key=(1<<3)|0=8
0x02                    # varint 2

# field 2 (name), wire_type=2 (length-delim)
0x12                    # key=(2<<3)|2=0x12
0x05                    # len=5
"Alice"

# field 3 (emails) repeated, wire_type=2
0x1a 0x03 "a@x"         # key=(3<<3)|2, each appearance is one field
0x1a 0x03 "b@x"

# field 4 (address), wire_type=2
0x22 0x0f               # len=15
  0x0a 0x04 "Main"      # field 1, wire_type 2
  0x12 0x03 "PDX"
  0x1a 0x02 "OR"
```

总 ~30 字节。同样的 JSON 至少 70 字节。

### 2.6 前向兼容

未知字段 (field_number 客户端不认识) → **skip via wire_type**：
- type 0:读完一个 varint
- type 1:读 8 字节
- type 2:读 length 字段后再读 length 字节
- type 5:读 4 字节

→ 加新字段不破老客户端。但**改 wire_type 必坏**（field 1 从 varint 变 length-delim），所以 schema 演进只能：
- 加新 field_number
- 老字段保留但标 `reserved`
- 类型不兼容时改名 + reserved

---

## 三、gRPC over HTTP/2

### 3.1 一次调用布局

```http
HEADERS stream_id=N (END_HEADERS=1, END_STREAM=0):
   :method  = POST
   :scheme  = https
   :path    = /myapp.Users/GetUser
   :authority = api.example.com
   content-type = application/grpc+proto
   te = trailers
   grpc-encoding = identity
   grpc-accept-encoding = identity, gzip
   x-request-id = 4f5a8...

DATA frame (END_STREAM=0):
   5 字节前缀: 1 字节 compressed_flag + 4 字节 length (≤ 2^32)
   + protobuf bytes "4f 0a 02 41 ..."

HEADERS frame (END_HEADERS=1, END_STREAM=1, trailers 状态 帧):
   grpc-status = 0
   grpc-message = OK
```

### 3.2 4 种 RPC 模式

```proto
service MyService {
    rpc GetUser(GetUserReq) returns (User);                    // unary
    rpc StreamNews(SubscribeReq) returns (stream NewsUpdate);  // server stream
    rpc Sum(stream Num) returns (Sum);                         // client stream
    rpc Chat(stream Msg) returns (stream Msg);                 // bidi
}
```

| 模式 | req | resp | HTTP/2 stream 数 |
|------|-----|------|------------------|
| unary | 1 | 1 | 1 |
| server | 1 | N | 1 (N DATA frame) |
| client | N | 1 | 1 |
| bidi | N | N | 1 双向 DATA frame 交错 |

所有 4 模式都走同一条 HTTP/2 stream (trades multiplexing)。

### 3.3 错误码 (grpc-status)

| code | 含义 |
|------|------|
| 0 | OK |
| 1 | CANCELLED |
| 2 | UNKNOWN |
| 3 | INVALID_ARGUMENT |
| 4 | DEADLINE_EXCEEDED |
| 5 | NOT_FOUND |
| 6 | ALREADY_EXISTS |
| 7 | PERMISSION_DENIED |
| 8 | RESOURCE_EXHAUSTED |
| 9 | FAILED_PRECONDITION |
| 10 | ABORTED |
| 11 | OUT_OF_RANGE |
| 12 | UNIMPLEMENTED |
| 13 | INTERNAL |
| 14 | UNAVAILABLE |
| 15 | DATA_LOSS |
| 16 | UNAUTHENTICATED |

业务错误应**用 trailer 中的 grpc-message**或自定义 metadata，不要靠 status codes。OK=0 是 success，非 0 都视为 RPC failure。

### 3.4 gRPC interceptors

```go
// server-side
type serverInterceptor struct{}
func (s *serverInterceptor) Unary(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
    md, _ := metadata.FromIncomingContext(ctx)
    traceID := md.Get("x-request-id")
    ctx = context.WithValue(ctx, "trace_id", traceID)
    start := time.Now()
    resp, err := handler(ctx, req)
    log.Printf("RPC %s status=%v dur=%v", info.FullMethod, status.Code(err), time.Since(start))
    return resp, err
}

s := grpc.NewServer(grpc.UnaryInterceptor(&serverInterceptor{}))
```

interceptor 链式：trace → metrics → auth → biz logic。

### 3.5 实战性能

```go
// 完整机房 setup
conn, _ := grpc.DialContext(ctx, addr,
    grpc.WithTransportCredentials(tls),
    grpc.WithDefaultCallOptions(
        grpc.MaxCallRecvMsgSize(64 * 1024 * 1024),  // 默认 4MB, 例 64MB
        grpc.MaxCallSendMsgSize(64 * 1024 * 1024),
    ),
    grpc.WithInitialConnWindowSize(8 * 1024 * 1024),   // TCP 流控
    grpc.WithInitialWindowSize(8 * 1024 * 1024),       // stream
    grpc.WithDefaultServiceConfig(`{"loadBalancingConfig": [{"round_robin": {}}]}`),
    grpc.WithKeepaliveParams(keepalive.ClientParameters{
        Time:                30 * time.Second,
        Timeout:             10 * time.Second,
        PermitWithoutStream: true,
    }),
)
```

关键点：
- 每项 call 默认 60s timeout
- HTTP/2 100 max concurrent streams 限制 → gRPC client 单 conn 同时调用上限 100
- 建议 client pool ≥ 10 conn
- `PermitWithoutStream=true` 让 keepalive 不需 active call 才发，防 NAT 老化 timeout 杀连接

---

## 四、Thrift

### 4.1 .thrift schema

```thrift
struct User {
    1: i32 id
    2: string name
    3: list<string> emails
}

service UserService {
    User getUser(1: i32 id),
    oneway void deleteUser(1: i32 id),
}
```

### 4.2 TBinaryProtocol

固定 4-byte 字段编号 + 类型：
```
struct 序列化:
  field: [1 byte type] [2 byte field_id] [value]
  end: [1 byte = 0]
```

字段编号显式 → 跨语言解码稳定。

### 4.3 TCompactProtocol

类似 Protobuf，用 varint，更紧凑。

### 4.4 Transport 层

- TSocket：raw TCP
- TBufferedTransport：buffered TCP
- TFramedTransport：每 message 前缀 length (类似 length-delimited)
- THttpClient：HTTP 1.1 wrapper

### 4.5 现状

| 用户 | 用法 |
|------|------|
| Facebook | 内部 API 仍主力 |
| Twitter (Finagle) | Scala Finatra Thrift |
| Uber | TChannel → 后迁 H1 |
| Cassandra | thrift API (deprecated) |

行业主流已迁 gRPC，但少数大公司仍维护 Thrift。

---

## 五、Avro

### 5.1 schema + 数据流

```json
{
  "type": "record",
  "name": "User",
  "fields": [
    {"name": "id", "type": "int"},
    {"name": "name", "type": "string"},
    {"name": "emails", "type": {"type": "array", "items": "string"}}
  ]
}
```

序列化：
- **字节流中不带 field_number**：靠 schema 在 reader/writer 协同
- reader 用 schema 兼容性矩阵处理不同版本 (back 包装)
- 一条记录 30 字节要比 Protobuf 5-10%

Kafka + Avro 是大数据栈标配。Schema Registry (Confluent) 存所有 schema 版本，serializer 在 record 头加 4 字节 schema id。

### 5.2 Avro vs Protobuf

| 维度 | Avro | Protobuf |
|------|------|----------|
| 字段编号 | 不带，schema 协同 | 1, 2, 3... 显式 |
| 字节大小 | < Protobuf (10%) | 紧凑 |
| schema 漂移 | 强 map 隐式类型 | reserved + 类型不变 |
| 流传输 | 不带 schema id → 配 Kafka Schema Registry | 自描述 |
| 主要生态 | Hadoop, Kafka, Confluent | gRPC, Envoy, GRPC |

---

## 六、产线实战灾情

### 6.1 gRPC stream leak — server 内存爆

业务 client 不 `CloseSend()` 直接退出 → server 保留 stream context 直到 idle (1h) → 5k client × 1h = 500k concurrent streams → 内存 500 MB ×N → OOM。

**修复**：
1. client 强制 `defer stream.CloseSend() + ctx cancel`
2. server 监控 `grpc_server_stream_started` 长寿命数
3. server stream max age `MaxConnectionAge = 30m + GracefulStop`

### 6.2 gRPC metadata 超 8KB

某 API client 把 JWT token + 业务 metadata 全塞进 metadata → 16KB → HTTP/2 SETTINGS frame reject 默认 8KB，server 主动 reset stream。

**修复**：
1. JWT 走 binary DATA frame 或 service-local context，不放 metadata
2. 服务端 nginx 配 `http2_max_field_size 32k; http2_max_header_size 64k;`
3. 客户端控制 metadata 总字节并日志预警

### 6.3 conn pool 大小不当

Web Tier 起 50 connection pool、每并发 100 QPS → backend 单连接 5k QPS、HTTP/2 100 stream 限制 → 5conn 满后余 0。流量超时 5k RPS。

**修复**：
```go
poolSize = ceil(QPS_per_conn / max_streams_per_conn) * 1.5
// e.g., QPS 50k / 100 stream* 100 qps/stream = 5 conn, *1.5 = 8 conn安全
```

### 6.4 protobuf 字段类型 wire-type 漂移

某业务 schema 升级把 field 3 从 `int32` 变 `string` → 老 client 跳 wire_type 0，新 server 写 wire_type 2 → 老 client 跳过 → field 默认 0 → 业务 silent fail。

**修复**：用 `reserved 3`，新加 field `string newfield = 4`。

### 6.5 Avro schema 漂移反写

某业务 schema v2 把 `int id` 改 `long id` → 老 consumer Bei schema v1 读 → `int → long` 是合法扩展，但 `long → int` 不行 → producer 升级 v2 没事，consumer 升级 v2 但 produce 旧 v1 数据 from backup consumer crash。

**修复**：Avro 强 backward / forward 兑 schema registry `confluent.compatibility=BACKWARD` 锁。

---

## 七、易错清单

1. **Protobuf 不能改 wire_type**：field_id 类型可能漂移 → 用 reserved + 新编号
2. **repeated packed vs unpacked**：proto3 默认 packed，读取端兼容但旧 proto2 后向不兼容
3. **gRPC stream 报错是 trailer**：HTTP/2 HEADERS frame 后置语义，不会出现在前置 frame
4. **proto enum 必须有 0 value**：proto3 强要求 (默认值)
5. **gRPC metadata 与 HTTP/2 headers 一致**，但 8KB 大小限制是 HTTP/2 默认上限
6. **gRPC 0 错误 vs http 200 OK**：gRPC level 错误独立于 HTTP，**HTTP status 永远是 200**，grpc-status trailer 给业务语义
7. **Thrift vs Protobuf 大体相同字节**，主要差别在 community + 工具链
8. **JWT 在 gRPC metadata 中可能超 8KB**；考虑放 propagated ctx 或 sidecar encrypt

---

## 八、这一章带走的东西

1. Protobuf 字节布局是 varint + wire_type + length-delimited，前向兼容靠 wire_type skip，schema 漂移靠 reserved + new field
2. gRPC-over-HTTP/2 用 stream_id 复用 + trailer 状态 锁定 grpc-status 语义；4 模式通用 1 HTTP/2 stream
3. Thrift 与 Protobuf 编码相近，Thrift 显式 field number，Protobuf 显式 wire-type skip → 各自设计取向
4. Avro 不带 field 编号、靠 schema registry 协同，**Kafka 数据生态主流**
5. gRPC 关键调优点：conn pool size = QPS × 1.5 / 100_streams_per_conn、metadata 8KB、keepalive + max_age
6. stream leak 是 gRPC server 短寿工程盲区：必须 monitor stream age 分布与 grpc_server_stream_started 增量

## 下一节 →

[QUIC 概览](../quic/overview.md) — QUIC packet 格式、stream 帧、conn ID、connection migration、loss recovery。
