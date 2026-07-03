# SSMT Documentation

## Overview

SSMT is a language for writing highly parameterizable instances of SMT problems. It is conceptually similar to the practice of writing custom scripts to generate SMTLib code based on certain parameters, but integrates the parameterized generation logic into the SMT problem description syntax. SSMT files go through two phases:
1. *Compile Time*: This is the time during which the SSMT file (along with its inputs) are converted to an SMTLib file. At this point, only SMT variable declarations and assertions remain. See the [README](./README.md) for how to invoke this step.
2. *Solve Time*: This is the time during which the SMTLib file is checked for satisfiability by a solver such as cvc5 or z3.

The overarching structure of an SSMT file is a series of declarations, assignments, and assertions. Declarations and assignments have effects at *Compile Time*, which happen in the order they appear. Assertions are order-independent, in the sense that they only have impacts at *Solve Time*.

Syntactically, SSMT is vaguely C-like, in the sense that curly braces are used to group statements and whitespace is not significant (as opposed to Python's indentation-based grouping). However, in contrast to most C-like languages, semicolons are **not** used as line terminators.

## Simplest Program
The [SSMT Interactive Compiler](https://elkwizard.github.io/SSMT/interactive) is the best way to experiment with SSMT features. It automatically handles logic declaration for you, but if you want to create a standalone SSMT file, the simplest valid program includes just a `logic` declaration, which specifies which of the [SMTLib logics](https://smt-lib.org/logics.shtml) should be used to interpret the resulting assertions and declarations at *Solve Time*. Thus, the simplest SSMT program is:
```js
logic QF_AX 
```
For the rest of this documentation, unless otherwise specified, examples will assume a reasonable logic declaration is present at the top of the file, and it will be omitted. Note that a file may contain multiple `logic` declarations, and only the last one to be reached will be used by the solver.

## SMT Variables and Assertions
To make any interesting SMT instances, variables are necessary. To state that two real variables `x` and `y` exist and must satisfy `(< x y)`, one can use the following SSMT file:
```js
x : Real
y : Real
x < y
```
This declares two SMT variables, and the final line, despite not being marked in any way, represents a true assertion on these variables. Since the variables in an SMT instance are often of the same type, SSMT provides the shorthand `default : Type` to specify the type of all new variables until the next `default` declaration. This can be used to shorten the previous program to:
```js
default : Real
x < y
```
Note that neither `x` nor `y` are explicitly declared. This is a questionable but convenient feature of SSMT: when a undeclared variable is encountered, it is declared in the global scope as an SMT variable with the current `default` type. For integer-related problems this syntax is even more convenient and questionable, as the initial `default` type is `Int`.

## Basic Connectives
Like most programming languages (and SMTLib), SSMT supports basic logical connectives and arithmetic operators. Some operators will be explained later, but most have obvious semantics. Additionally, certain operators can only be used with constant operands and cannot be used in assertions on SMT variables. The following operators are listed in order of decreasing precedence.

| | Name | Operator | Constant Only |
| --- | --- | --- | --- |
| 0 | Negate | `-a` | No |
| 0 |  Not | `~a` |  No |
| 1 | Power | `a ^ b` | Yes |
| 2 | Product | `a * b`, `a / b`, `a % b` | `/` and `%` |
| 3 | Aggregate | `<agg> <range> of <exp>` | No |
| 4 | Sum | `a + b`, `a - b` | No |
| 5 | Compare | `a < b`, `a <= b`, `a = b`, `a != b`, etc. | No |
| 6 | Logic | `a and b`, `a or b` | No |
| 7 | Implication | `a => b` | No |
| 8 | For | `for <range\|universal> <exp>` | No |

**Note:** Though not stated in this table, the comparison operators can be chained with the standard mathematical meaning, so `1 < x = y` means `(1 < x) and (x = y)`.

## Normal Variables
Variables which exist at *Solve Time*, such as `x` and `y` in the first example program, are referred to as "SMT variables" in this documentation, to contrast them with normal variables, or simply "variables", which only exist at *Compile Time*. SSMT's *Compile Time* execution is loosely and dynamically typed, so variables are declared and used differently. Specifically, variables must be assigned a value before they are used, unlike SMT variables. This uses the assignment operator `:=`, which has lower precedence than any in the previous section's table. In addition to user-defined variables, there are a few system-defined variables in scope at the beginning of any SSMT program. They are as follows:

* `InputCount`: The number of inputs given to the SSMT executor.
* `Input_1`, `Input_2`, etc: A variable for each input given to the SSMT executor.
* `Sqrt`: A function which takes in a *Compile Time* value and returns its square root.
* `Min`, `Max`: Functions which take in two *Compile Time* values and return their minimum and maximum respectively. 

To declare your own variable, you can use the following syntax:
```js
y := 3 + 5
x < y
```
The variable `y` exists **only** at *Compile Time*, so the SMT solver will only see the constraint `x < 8`, in terms of a single SMT variable `x`. Notably, unlike many other language constructs in SSMT, *Compile Time* variables need not have *Compile Time*-constant values. For example, the same program could be written as follows, even though `x` is an SMT variable:
```js
z := x
y := 3 + 5
z < y
```

## SMT Functions
Using *Solve Time* functions in SSMT is only distinct from using SMT variables in that it uses different type syntax. To declare an SMT function which takes in three integers and returns a real number, the following syntax can be used:
```js
myFunction : Int, Int, Int -> Real
```
Then, to assert values of the function, simply use standard assertion syntax:
```js
myFunction : Int, Int, Int -> Real
myFunction(1, 2, 3) = 5
5 = myFunction(1, 2, 3) // equivalent alternative
```
Currently, directly defining bodies for functions is not supported, but it can be emulated with universal `for` statements and assertions (or better with SSMT functions, as explained below).

## Functions
Similar to the distinction between SMT variables and variables, SSMT also supports normal "functions", which only exist at *Compile Time*. Functions in SSMT are first-class objects, and are created using `fn` expressions. Notably, since they are called at *Compile Time* and disappear in the final output, they are much more similar to macros in other languages, like C/C++ or Rust. To create a function which multiplies its arguments, the following syntax can be used:
```rust
MyMultiply := fn (a, b) a * b
MyMultiply(x, 3) < 4
```
This will become the SMTLib constraint `(< (* x 3) 4)`, with the function having disappeared entirely by *Solve Time*. This example demonstrates several interesting properties of SSMT functions. First of all, the function is able to take a non-*Compile Time* value (`x`) as an argument, similar to how variables can hold non-*Compile Time* values. Additionally, the body of the function is simply *any expression*, rather than a braced block as in many languages (they are allowed, however). For completeness, it bears mentioning that the first-class nature of functions (and their closure support) allows higher order functions to be defined, such as function composition:
```rust
Compose := fn (f, g) fn (x) f(g(x))
Add2 := fn (x) x + 2
Mul3 := fn (x) x * 3
y >= Compose(Add2, Mul3)(4) // y >= (2 + 3 * 4)
```

## Names and Subscripts
Now is as good a time as any to mention that the subscripts (which can be present on all names) in SSMT are not simply part of the variable names, but in fact a separate system. A reference like `x_1` does refer to the variable `x_1`, but if `i := 1`, then `x_i` *also* refers to the variable `x_1`. In fact, all subscripts of a variable (there may be multiple, separated by non-whitespaced commas) are expressions, which need only be *Compile Time*-constant, rather than literal numbers. However, only simple expressions, like numbers and variables, can be used as subscripts directly. For more complex expressions, parentheses are needed, i.e. `x_(i % 4 + 1)`. All names in SSMT can be subscripted, including but not limited to: parameter names, loop variable names, and type names. SSMT's expression subscripts (along with auto-declaration of SMT variables) is useful for the common task of creating extremely high numbers of SMT variables.

**Note:** The grammar of SSMT is such that nested subscripts behave as expected, so `x_i_j` is interpreted as `x_(i_j)`.

## Aggregates
Certain operations are commonly performed over contiguous ranges of integers, in SMT instances and math in general. For example, Σ and Π notation for sums and products often have index variable(s) ranging over some integer interval. This is enabled in SSMT via aggregate expressions, such as `sum`:
```js
sum i, j on [1, 5] of x_i,j = 50
```
This implicitly declares 25 subscripted `x_*` SMT variables of type `Int` and asserts that their sum is 50. This particular `sum` would typically require a nested for loop in most languages, but SSMT uses a more mathematical notation, and implicitly iterates over all combinations of two integers in the range `[1, 5]`. Currently, only two aggregates exist, but more are likely to be added in the future:
* `sum`: Adds together a collection of values
* `distinct`: True iff all values are distinct

These aggregates all use the same syntax as `sum`, just with a different initial keyword.

## For Expressions
As in many languages, SSMT features for loops. These loops come in two flavors, ranged and universal, which differ only in what they iterate over. All for loops are expressions (rather than typical loops, which are statements), and their value is the logical AND of their body's values over all iterations. If the for loop's body does not produce a value (an assignment or declaration), then the for loop doesn't produce a value either.

### Ranged For Expressions
Ranged for expressions are very similar in form and function to aggregate expressions as described above, and could almost be considered to be an `and` aggregate, except for slightly different syntax. Additionally, a for expression's body need not evaluate to a value, which an aggregate's body requires. See "Result Summaries" below for an example of a for loop with a value-less body. A ranged for expression's syntax is identical to an aggregate, but omits the `of`, so to claim that `x_i < y_i` for `i` from 1 to 7, the following loop could be used:
```js
for i on [1, 7] x_i < y_i
```
Just like aggregates, multiple variables can be declared in the loop header, which will behave like a nested loop in other languages. An alternative perspective on the ranged for expression is that it resembles a universal quantifier, with `for i on [1, 7] P(i)` meaning *∀ i ∈ [1,7] P(i)*. This interpretation explains the existence of the other type of for expressions as well.

### Universal For Expressions
Universal for expressions are a notation for the `(forall ...)` operator in SMTLib (and mathematics). It allows you to make a claim about all possible values of one or more variables in a given type. The syntax for universal for expressions is:
```rust
for x, y : Real P(x, y)
```
Where `P(x, y)` stands for any expression, which has access to `x` and `y`. Using the standard mathematical trick for domain restriction, one can quantify over all *positive* integers, for example, using an implication (the first set of parentheses are optional, but included for clarity):
```rust
for x : Int (x > 0) => P(x)
```
**Note**: This syntax is not part of the universal for expression; it is simply a useful way to combine for loops and implications.


## Blocks
In many places where one expression is valid (such as the body of an aggregate, for expression, or function), it can be desirable to have multiple expressions or locally scoped variables. In SSMT, this is achieved with curly-braced blocks. At a surface level, blocks look similar to those in other languages, but they have some unusual characteristics that make them more suitable for phrasing SMT problems. Specifically, a block consists of an opening brace (`{`), followed by any number of assignments, assertions, and declarations, followed by a closing brace (`}`). The assignments are local to the block*, and the resulting value is the logical AND of all the assertions in the block. This might seem to imply that blocks can only produce boolean results, but AND-ing together a single value doesn't cast it to a boolean. As such, a block consisting of assignments, declarations, and a **single** expression will evaluate to that expression. An example of such a block is shown in the following example, which sums the square roots of the first 5 squares:
```js
sum i on [1, 5] of {
	square := i ^ 2
	Sqrt(square)
}
```

*This can be avoided by prepending `weak` before the opening brace, which will allow assignments to leak into the surrounding scope. The scope created by ranged `for` is inherently weak, so it can be used to declare multiple variables if necessary: `for i on [1, 5] x_i := i * 2`.

The AND-ing behavior of blocks is also present in the global scope, where all expressions are implicitly AND-ed together to create a single assertion in SMTLib.

## Tuples
Tuple types can be declared in SSMT with the `type` keyword. For example, to declare an integer real tuple, the following syntax could be used:
```hs
type MyTuple = (Int, Real)
```
`MyTuple` can then be used in any location expecting a type, such as an SMT variable or SMT function declaration. To create a value of this type, use the `new` keyword:
```js
tuple : MyTuple
new MyTuple(3, 5.8) = tuple
```

To access particular tuple indices, use `.<number>` syntax, as in:
```js
4 = tuple.1 // this is false
5.8 = tuple.2 // this is true
```

## Variadic Expressions
Occasionally, one may want to create a function (or call a function) with a number of arguments that depends on the inputs to the SSMT compiler. For example, an SSMT program could make a claim about *N* points, where *N* varies. If this program contained a predicate `fn` on those *N* points however, it would be impossible to declare, since the number of parameters would be unknown until the problem-specific inputs are provided. To this end, two kinds of "variadic" "expressions" are provided ("expressions" is quoted because this syntax can occur in non-expression areas).

### Variadic Subscript
In addition to simple subscripts like `x_i`, variadic subscripts like `x_1..N` expand to (effectively) a comma-separated list of `x_1, x_2, ..., x_N`. Like normal subscripts, `1` and `N` in this example can be simple expressions, or arbitrary expressions if parenthesized, i.e. `x_1..(N - 1)`.

### General Variadic Loop
Using syntax similar to aggregates and for expressions, arbitrary expressions can be evaluated a variable number of times and expanded into (effectively) a comma-separated list. For example, `..i on [1, 5] i ^ 2` expands to `1, 4, 9, 16, 25`.

### Example
The following SSMT program creates a predicate over *N* values, where *N* is provided as the first input value. It asserts that the remaining inputs are *N* integers between 1 and 10 (inclusive) which are all distinct:
```js
N := Input_1

IsValid := fn (x_1..N) {
	distinct i on [1, N] of x_i
	for i on [1, N] 1 <= x_i <= 10
}

RightCount := InputCount = N + 1

RightCount // this must hold

// don't try to evaluate the variadic expression 
// unless there are the right number of inputs (=> short circuits)
RightCount => IsValid(Input_2..InputCount)
```

**Note:** Since this problem only depends on its inputs and declares no SMT variables, it compiles down to simply `(assert true)` or `(assert false)` in SMTLib.

## Result Summaries
Sometimes in SMT instances, only a few variables are actually interesting to look at in the case of satisfiability. If this is the case, the `show` command can be used to display only a subset of results. If no variables are shown, then all variables are considered shown. **Note**: This feature only has an effect if the CLI is used to solve the SSMT program. It has no effect on the resulting SMTLib code.

```js
sum i, j on [1, 5] c_i,j = 50
for i on [1, 5] show c_i,1 // only display the first row
```