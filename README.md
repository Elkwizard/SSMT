# <img src="./ssmt-language-support/Icon.svg" width="30"> SSMT 
SSMT is a minimalist macro language for writing [SMTLib](https://smt-lib.org/) programs in a more standard mathematical syntax. This repository includes a [VSCode extension for syntax highlighting SSMT](https://elkwizard.github.io/SSMT/ssmt-language-support/ssmt-language-support-0.0.1.vsix`), and [documentation](./docs.md) to learn the language.

The language can be used in two ways:

### Command Line Interface
After cloning the repository, create a shell script which forwards all of its arguments to an SMTLib solver such as cvc5 or z3. Suppose this shell script is at `SOMEPATH/solve.sh`. Then, the cli can be invoked as follows from within the repository:

```sh
node cli.js --solver SOMEPATH/solve.sh OTHERPATH/SSMTFILE.ssmt
```

### Interactive Compiler
Visit the [GitHub pages site](https://elkwizard.github.io/SSMT/interactive) for this repo, and enter SSMT code into the left panel. The theory can be selected from the "logic" dropdown, and the input values (`Input_1`, `Input_2`, etc.) can be specified via a space-separated list in the "inputs" box.