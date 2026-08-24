# 类型系统、类型推断、HM 类型系

## TL;DR

类型系统是编译器最 invariant 的 guarantee：每个表达式有唯一类型，运行时不需要 dynamic check。Hindley-Milner 是 ML/Haskell/OCaml/F# 的 polymorphic type inference 算法，自 1969 是 typing 历史。本节讲完 static vs dynamic、soundness (progress + preservation)、HM algorithm W、let-polymorphism、rank-N polymorphism、subtyping、Rust affine / linear type、dependent types、lifetime 系、effect 系统。

---

## 一、类型系统目标

类型系统是"定律 invariant":
1. **soundness**: well-typed program does not get stuck (no type error at runtime)
2. **progress + preservation** (Formal verification): every well-typed term reduces, reduction preserves type
3. **completeness**: any typeable term compiles → runtime type-safe

Formal: type judgment `Γ ⊢ e : T` 是 partial function 给出 expression 的 type ∈ Types ∪ {error} ("stuck").

## 二、static vs dynamic

| 维度 | static | dynamic |
|------|--------|---------|
| 检测时机 | compile time | runtime |
| 性能 | nocost | runtime check overhead |
| 灵活性 | 严格 | 灵活动态 (heterogeneous list) |
| 重构 | IDE 自动 sweep | 困难 (grep) |
| Debug | type-error 编译报 | runtime 错 |
| examples | Haskell, Rust, Java, C#, Go | Lisp, Python, JS, Ruby |

gradual typing (TypeScript、Reticulated Python) allows mixed: static + dynamic check, type annotation optional。

## 三、Hindley-Milner

HM (Hindley 1969, Milner 1978) 算法 W 是 ML 等的 type inference 算法。

### 3.1 类型 scheme

```
σ := ∀α.α → α                    -> identity type
τ := α | τ → τ | Int | String    // monotype
```

unification: `unify(t1, t2)` returns substitution `S` such that `S t1 = S t2`.

### 3.2 Algorithm W

```
W(env, e):
match e:
    Var(x) => instantiate(env[x]) → returns (subst, type)
    App(e1, e2) =>
        (s1, t1) = W(env, e1)
        (s2, t2) = W(s1 env, e2)
        α = fresh_var()
        s3 = unify((s2 t1), (t2 → α))
        return (s3 ∘ s2 ∘ s1, s3 α)
    Lam(x, e) =>
        α = fresh_var()
        env' = env + {x : α}
        (s1, t1) = W(env', e)
        return (s1, s1 α → t1)
    Let(x, e1, e2) =>
        (s1, t1) = W(env, e1)
        env' = s1 env + {x : Gen t1}     // generalise
        (s2, t2) = W(env', e2)
        return (s2 ∘ s1, t2)
```

Gen 是 generalize：把 monotype 中所有未被 env 约束的类型变量量化成 scheme（`τ → ∀α.τ`），这就是 let 绑定多态的来源——`let id = fn x => x` 之后 `id` 可以同时用于 `int` 和 `string`。

### 3.3 Value Restriction

只有 let 右侧是**语法值**（variable / constant / constructor 全量应用 / `fn` 抽象）才允许泛化；含函数调用的表达式一律不泛化。否则与可变引用组合会破坏 soundness——经典的反例：

```
let id = ref (fn x => x)
id := true
!id(0)
```

OCaml/Haskell 都只对 let 绑定做泛化（let-polymorphism），且受 value restriction 约束：右侧必须是语法值才能泛化。参数多态（如 `'a list -> 'a list` 的显式泛型）不受此限，因为量化边界是显式写出来的。

## 四、Subtyping

```
S <: T  (S sub type of T)
```

substitutability: 需要 T 的位置都能放 S (OO 的 extends/implements 就是它的特例).

一旦 subtyping 与多态组合（Java 泛型 / Scala / C++ 模板 + 继承），**principal type 一般不存在，完整推断不可判定**（推断复杂度随类型构造器增长到不可解）。所以这类语言都退而求其次：泛型参数显式标注、推断只做局部（方法内），跨方法边界一律靠声明。

```
Γ ⊢ e : T   T <: T'
------------------T-SUB
Γ ⊢ e : T'
```

## 五、Rust affine / lifetime

Rust 类型系统是 affine / linear：每 owned value move 一次：

- ownership: 每值 one owner
- 借用: `&T` immutable, `&mut T` mutable exclusive
- lifetime `'a` 是借用区域 (static scope of valid ref)
- borrow checker: 多 lifetime constraint 跨 region 一致

```rust
fn longest<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.len() > b.len() { a } else { b }
}
```

`'a` 最小 lifetime ∀ input (lifetime 参数)。Rust 推断 non-lexical lifetimes (NLL, 2018+) 让 ref 释放 time optimize in context-aware.

## 六、Dependent types

dep types 是 type-level dependent 于值：
```idris
Vector : Nat -> Type -> Type
Vector 0 a = VecNil
Vector (S n) a = VecCons a (Vector n a)
```

Idris / Agda / Coq / Lean. 适 formal proof, 设计 contract / invariant.

## 七、Effect system

Effect 类型系统描述计算 effect (`Pure`, `IO`, `State a`, `Async`):

Haskell `IO` monad deprivation side, Haskell `State`，OCaml effect handlers:
```haskell
f :: State Int ()
```

Koka语言第一成 effects 类型化，ML computation effect effect handlers 一流.

Rust async 是 effect-type area: `async fn` returns `impl Future<Output=T>`, 类型与 Future type bound.

## 八、产线观察

### 8.1 Rust borrow checker NLL
2018 版 NLL 让 ref 在 last-use 自动 freeze 释放。某些之前拒绝 code 现 OK.

### 8.2 TypeScript structural typing
类型按 shape（结构）而不是名字匹配 (与 nominal 系 like Rust 的 NOT). value fit shape 可隐式 assignment, 但太弱编 type DSL.

### 8.3 Effect system 实战
Haskell `IO` monad 限制 side effect 在 necessary `IO a`. 性 arg 后给到 Haskell Hakell Embed-system 限副作用.

## 九、易错清单

1. **value restriction** 在 OCaml let polymorphic only well-typed value 参考
2. **NLL** rustc borrow checker modulo
3. **TS structural typing** 边界; mood / nominal type of go interface Pola 亦 structural nominal
4. **Dependent types** 一阶 type theory 限 Parser quotient, 可 DVN Construct explicit Idries 解释 程 objective
5. **Type-level computation** O(1): rebase Go constraints O(U(0)) type.
6. **effect polymorphism** is not yet cross-language standard (Koka is exception)

## 十、这一章带走的东西

1. 类型系统保证 soundness (progress + preservation)
2. HM algorithm W 是 ML 系 polymorphic type inference gold standard
3. let-polymorphism 让 code reuse; value restriction 之处 ref cell 安全
4. Rust affine 计: 一次 move 允; lifetime
5. NLL (rust 2018) 让 borrows checker ergonomics 大 improvement
6. Dependent types 是 ML extension 类型依赖值 Pi types 上 level Koka 6ef systems
7. effects 像 monad IO async state asymptote represent syntactic high-life might transform colony 系; Koka《Haskell》non-ML systems eras
