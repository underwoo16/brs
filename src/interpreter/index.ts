import {
    BrsType,
    ValueKind,
    BrsInvalid,
    isBrsNumber,
    isBrsString,
    BrsBoolean,
    BrsString,
    isBrsBoolean,
    Int32,
    isBrsCallable,
    Uninitialized,
    BrsArray,
    isIterable,
    SignatureAndMismatches,
    MismatchReason,
    Callable
} from "../brsTypes";

import { Lexeme } from "../lexer";
import { Expr, Stmt } from "../parser";
import * as BrsError from "../Error";

import * as StdLib from "../stdlib";

import { Scope, Environment, NotFound } from "./Environment";
import { OutputProxy } from "./OutputProxy";
import { toCallable } from "./BrsFunction";
import { BlockEnd, StopReason, PrintSeparator } from "../parser/Statement";
import { AssociativeArray } from "../brsTypes/components/AssociativeArray";
import MemoryFileSystem from "memory-fs";

/** The set of options used to configure an interpreter's execution. */
export interface ExecutionOptions {
    /** The base path for  */
    root: string,
    stdout: NodeJS.WriteStream,
    stderr: NodeJS.WriteStream
}

/** The default set of execution options.  Includes the `stdout`/`stderr` pair from the process that invoked `brs`. */
export const defaultExecutionOptions: ExecutionOptions = {
    root: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
};

export class Interpreter implements Expr.Visitor<BrsType>, Stmt.Visitor<BrsType> {
    private _environment = new Environment();

    readonly stdout: OutputProxy;
    readonly stderr: OutputProxy;
    readonly temporaryVolume: MemoryFileSystem = new MemoryFileSystem();

    get environment() {
        return this._environment;
    }

    /**
     * Creates a new Interpreter, including any global properties and functions.
     * @param outputStreams the WriteStreams to use for `stdout` and `stderr`.
     */
    constructor(outputStreams: ExecutionOptions = defaultExecutionOptions) {
        this.stdout = new OutputProxy(outputStreams.stdout);
        this.stderr = new OutputProxy(outputStreams.stderr);

        Object.keys(StdLib)
            .map(name => (StdLib as any)[name])
            .filter(func => func instanceof Callable)
            .filter((func: Callable) => {
                if (!func.name) {
                    throw new Error("Unnamed standard library function detected!");
                }

                return !!func.name;
            })
            .forEach((func: Callable) =>
                this._environment.define(Scope.Global, func.name || "", func)
            );
    }

    /**
     * Temporarily sets an interpreter's environment to the provided one, then
     * passes the sub-interpreter to the provided JavaScript function. Always
     * reverts the current interpreter's environment to its original value.
     * @param func the JavaScript function to execute with the sub interpreter.
     */
    async inSubEnv(func: (interpreter: Interpreter) => Promise<BrsType>): Promise<BrsType> {
        let originalEnvironment = this._environment;
        let newEnv = this._environment.createSubEnvironment();
        try {
            this._environment = newEnv;
            return await func(this);
        } finally {
            this._environment = originalEnvironment;
        }
    }

    async exec(statements: ReadonlyArray<Stmt.Statement>) {
        let results: BrsType[] = [];

        // resolve statement promises in a loop to ensure statements are executed in order.
        for (let statement of statements) {
            results.push(await this.execute(statement));
        }

        try {
            let maybeMain = this._environment.get({ kind: Lexeme.Identifier, text: "main", line: -1, isReserved: false });
            if (maybeMain.kind === ValueKind.Callable) {
                results = [ await maybeMain.call(this) ];
            }
        } catch (err) {
            throw err;
        } finally {
            return results;
        }
    }

    visitAssign(statement: Expr.Assign): BrsType {
        return BrsInvalid.Instance;
    }

    visitNamedFunction(statement: Stmt.Function): BrsType {
        if (statement.name.isReserved) {
            throw BrsError.make(`Cannot create a named function with reserved name '${statement.name.text}'`, statement.name.line);
        }

        if (this.environment.has(statement.name, [Scope.Module])) {
            // TODO: Figure out how to determine where the original version was declared
            // Maybe `Environment.define` records the location along with the value?
            BrsError.make(
                `Attempting to declare function '${statement.name.text}', but ` +
                `a property of that name already exists in this scope.`,
                statement.name.line
            );
            return BrsInvalid.Instance;
        }

        this.environment.define(Scope.Module, statement.name.text!, toCallable(statement.func, statement.name.text));
        return BrsInvalid.Instance;
    }

    async visitReturn(statement: Stmt.Return) {
        if (!statement.value) {
            throw new Stmt.ReturnValue(statement.keyword, BrsInvalid.Instance);
        }

        let toReturn = await this.evaluate(statement.value);
        return Promise.reject(new Stmt.ReturnValue(statement.keyword, toReturn));
    }

    async visitExpression(statement: Stmt.Expression): Promise<BrsType> {
        return await this.evaluate(statement.expression);
    }

    async visitPrint(statement: Stmt.Print): Promise<BrsType> {
        // the `tab` function is only in-scope while executing print statements
        this.environment.define(Scope.Function, "Tab", StdLib.Tab);

        // Array.prototype.forEach would normally be the best choice, but it'd create another async
        // context the expressions in a print statement must be executed *in order* and we need the
        // index of each element as well.  The easiest option is a for loop with an integer.
        for (let index = 0; index < statement.expressions.length; index++) {
            let printable = statement.expressions[index];

            switch (printable) {
                case Stmt.PrintSeparator.Tab:
                    this.stdout.write(
                        " ".repeat(16 - (this.stdout.position() % 16))
                    );
                    break;
                case Stmt.PrintSeparator.Space:
                    if (index === statement.expressions.length - 1) {
                        // Don't write an extra space for trailing `;` in print lists.
                        // They're used to suppress trailing newlines in `print` statements
                        break;
                    }

                    this.stdout.write(" ");
                    break;
                default:
                    this.stdout.write(
                        (await this.evaluate(printable)).toString()
                    );
                    break;
            }
        }

        if (statement.expressions[statement.expressions.length - 1] !== Stmt.PrintSeparator.Space) {
            this.stdout.write("\n");
        }

        // `tab` is only in-scope when executing print statements, so remove it before we leave
        this.environment.remove("Tab");

        return BrsInvalid.Instance;
    }

    async visitAssignment(statement: Stmt.Assignment): Promise<BrsType> {
        if (statement.name.isReserved) {
            throw BrsError.make(`Cannot assign a value to reserved name '${statement.name}'`, statement.name.line);
        }

        let value = await this.evaluate(statement.value);
        this.environment.define(Scope.Function, statement.name.text!, value);
        return BrsInvalid.Instance;
    }

    async visitBinary(expression: Expr.Binary) {
        let lexeme = expression.token.kind;
        let left = await this.evaluate(expression.left);
        let right: BrsType = BrsInvalid.Instance;

        if (lexeme !== Lexeme.And && lexeme !== Lexeme.Or) {
            // don't evaluate right-hand-side of boolean expressions, to preserve short-circuiting
            // behavior found in other languages. e.g. `foo() && bar()` won't execute `bar()` if
            // `foo()` returns `false`.
            right = await this.evaluate(expression.right);
        }

        /**
         * Determines whether or not the provided pair of values are allowed to be compared to each other.
         * @param left the left-hand side of a comparison operator
         * @param operator the operator to use when comparing `left` and `right`
         * @param right the right-hand side of a comparison operator
         * @returns `true` if `left` and `right` are allowed to be compared to each other with `operator`,
         *          otherwise `false`.
         */
        function canCompare(left: BrsType, operator: Lexeme, right: BrsType ): boolean {
            if (left.kind === ValueKind.Invalid || right.kind === ValueKind.Invalid) {
                // anything can be checked for *equality* with `invalid`, but greater than / less than comparisons
                // are type mismatches
                return operator === Lexeme.Equal || operator=== Lexeme.LessGreater;
            }

            // and only primitive non-invalid values can be compared to each other (i.e. no `foo <> []`)
            return left.kind < ValueKind.Dynamic && right.kind < ValueKind.Dynamic;
        }

        switch (lexeme) {
            case Lexeme.Minus:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.subtract(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to subtract non-numeric values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Star:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.multiply(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to multiply non-numeric values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Caret:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.pow(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to exponentiate non-numeric values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Slash:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.divide(right);
                }
                throw BrsError.typeMismatch({
                    message: "Attempting to dividie non-numeric values.",
                    left: left,
                    right: right,
                    line: expression.token.line
                });
            case Lexeme.Mod:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.modulo(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to modulo non-numeric values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Backslash:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.intDivide(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to integer-divide non-numeric values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Plus:
                if (isBrsNumber(left) && isBrsNumber(right)) {
                    return left.add(right);
                } else if (isBrsString(left) && isBrsString(right)) {
                    return left.concat(right);
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to add non-homogeneous values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            case Lexeme.Greater:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.greaterThan(right);
            case Lexeme.GreaterEqual:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.greaterThan(right).or(left.equalTo(right));
            case Lexeme.Less:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.lessThan(right);
            case Lexeme.LessEqual:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.lessThan(right).or(left.equalTo(right));
            case Lexeme.Equal:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.equalTo(right);
            case Lexeme.LessGreater:
                if (!canCompare(left, lexeme, right)) {
                    throw BrsError.typeMismatch({
                        message: "Attempting to compare non-primitive values.",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }

                return left.equalTo(right).not();
            case Lexeme.And:
                if (isBrsBoolean(left) && !left.toBoolean()) {
                    // short-circuit ANDs - don't evaluate RHS if LHS is false
                    return BrsBoolean.False;
                } else if (isBrsBoolean(left)) {
                    right = await this.evaluate(expression.right);
                    if (isBrsBoolean(right)) {
                        return (left as BrsBoolean).and(right);
                    }

                    throw BrsError.typeMismatch({
                        message: "Attempting to 'and' boolean with non-boolean value",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                } else if (isBrsNumber(left)) {
                    right = await this.evaluate(expression.right);

                    if (isBrsNumber(right)) {
                        // TODO: support boolean AND with numbers
                        return left.and(right);
                    }

                    // TODO: figure out how to handle 32-bit int AND 64-bit int
                    throw BrsError.typeMismatch({
                        message: "Attempting to bitwise 'and' number with non-numberic value",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to 'and' unexpected values",
                        left: left,
                        right: await this.evaluate(expression.right),
                        line: expression.token.line
                    });
                }
            case Lexeme.Or:
                if (isBrsBoolean(left) && left.toBoolean()) {
                    // short-circuit ORs - don't evaluate RHS if LHS is true
                    return BrsBoolean.True;
                } else if (isBrsBoolean(left)) {
                    right = await this.evaluate(expression.right);
                    if (isBrsBoolean(right)) {
                        return (left as BrsBoolean).or(right);
                    } else {
                        throw BrsError.typeMismatch({
                            message: "Attempting to 'or' boolean with non-boolean value",
                            left: left,
                            right: right,
                            line: expression.token.line
                        });
                    }
                } else if (isBrsNumber(left)) {
                    right = await this.evaluate(expression.right);
                    if (isBrsNumber(right)) {
                        return left.or(right);
                    }

                    // TODO: figure out how to handle 32-bit int OR 64-bit int
                    throw BrsError.typeMismatch({
                        message: "Attempting to bitwise 'or' number with non-numeric expression",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                } else {
                    throw BrsError.typeMismatch({
                        message: "Attempting to 'or' unexpected values",
                        left: left,
                        right: right,
                        line: expression.token.line
                    });
                }
            default:
                BrsError.make(
                    `Received unexpected token kind '${expression.token.kind}'`,
                    expression.token.line
                );
                return BrsInvalid.Instance;
        }
    }

    async visitBlock(block: Stmt.Block): Promise<BrsType>{
        for (let statement of block.statements) {
            await this.execute(statement);
        }
        return BrsInvalid.Instance;
    }

    visitExitFor(statement: Stmt.ExitFor): never {
        throw new Stmt.ExitForReason();
    }

    visitExitWhile(expression: Stmt.ExitWhile): never {
        throw new Stmt.ExitWhileReason();
    }

    async visitCall(expression: Expr.Call) {
        let functionName = "[anonymous function]";
        if (expression.callee instanceof Expr.Variable) {
            if (expression.callee.name.text) {
                functionName = expression.callee.name.text;
            }
        }

        // evaluate the function to call (it could be the result of another function call)
        const callee = await this.evaluate(expression.callee);
        // evaluate all of the arguments as well (they could also be function calls)
        const args = await Promise.all(expression.args.map(this.evaluate, this));

        if (!isBrsCallable(callee)) {
            throw BrsError.make(
                `'${functionName}' is not a function and cannot be called.`,
                expression.closingParen.line
            );
        }

        functionName = callee.getName();

        let satisfiedSignature = callee.getFirstSatisfiedSignature(args);

        if (satisfiedSignature) {
            try {
                let mPointer = this._environment.getM();

                if (expression.callee instanceof Expr.DottedGet || expression.callee instanceof Expr.IndexedGet) {
                    let maybeM = await this.evaluate(expression.callee.obj);
                    if (maybeM.kind === ValueKind.Object) {
                        if (maybeM instanceof AssociativeArray) {
                            mPointer = maybeM;
                        }
                    } else {
                        BrsError.make("Attempted to retrieve a function from a primitive value", expression.closingParen.line);
                    }
                }

                return await this.inSubEnv(
                    async (subInterpreter) => {
                        subInterpreter.environment.setM(mPointer);
                        return await callee.call(this, ...args);
                    }
                );
            } catch (reason) {
                if (reason.kind == null) {
                    throw new Error("Something terrible happened and we didn't throw a `BlockEnd` instance.");
                }

                let returnedValue = (reason as Stmt.ReturnValue).value;
                let returnLocation = (reason as Stmt.ReturnValue).location;
                if (satisfiedSignature.signature.returns !== ValueKind.Dynamic && satisfiedSignature.signature.returns !== returnedValue.kind) {
                    throw BrsError.make(
                        `Attempting to return value of type ${ValueKind.toString(returnedValue.kind)}, `
                        + `but function ${callee.getName()} declares return value of type `
                        + ValueKind.toString(satisfiedSignature.signature.returns),
                        returnLocation.line
                    );
                }

                return returnedValue;
            }
        } else {
            function formatMismatch(mismatchedSignature: SignatureAndMismatches) {
                let sig = mismatchedSignature.signature;
                let mismatches = mismatchedSignature.mismatches;

                let messageParts = [];

                let args = sig.args.map(a => {
                    let requiredArg = `${a.name} as ${ValueKind.toString(a.type)}`;
                    if (a.defaultValue) {
                        return `[${requiredArg}]`;
                    } else {
                        return requiredArg;
                    }
                }).join(", ");
                messageParts.push(`function ${functionName}(${args}) as ${ValueKind.toString(sig.returns)}:`);
                messageParts.push(
                    ...mismatches.map(mm => {
                        switch (mm.reason) {
                            case MismatchReason.TooFewArguments:
                                return `* ${functionName} requires at least ${mm.expected} arguments, but received ${mm.received}.`;
                            case MismatchReason.TooManyArguments:
                                return `* ${functionName} accepts at most ${mm.expected} arguments, but received ${mm.received}.`;
                            case MismatchReason.ArgumentTypeMismatch:
                                return `* Argument '${mm.argName}' must be of type ${mm.expected}, but received ${mm.received}.`;
                        }
                    }).map(line => `    ${line}`)
                );

                return messageParts.map(line => `    ${line}`).join("\n");
            }

            let mismatchedSignatures = callee.getAllSignatureMismatches(args);

            let header;
            let messages;
            if (mismatchedSignatures.length === 1) {
                header = `Provided arguments don't match ${functionName}'s signature.`;
                messages = [ formatMismatch(mismatchedSignatures[0]) ];
            } else {
                header = `Provided arguments don't match any of ${functionName}'s signatures.`;
                messages = mismatchedSignatures.map(formatMismatch);
            }

            throw BrsError.make(
                [header, ...messages].join("\n"),
                expression.closingParen.line
            );
        }
    }

    async visitDottedGet(expression: Expr.DottedGet) {
        let source = await this.evaluate(expression.obj);
        if (!isIterable(source)) {
            throw BrsError.typeMismatch({
                message: "Attempting to retrieve property from non-iterable value",
                line: expression.name.line,
                left: source
            });
        }

        try {
            return source.get(new BrsString(expression.name.text));
        } catch (err) {
            throw BrsError.make(err.message, expression.name.line);
        }
    }

    async visitIndexedGet(expression: Expr.IndexedGet) {
        let source = await this.evaluate(expression.obj);
        if (!isIterable(source)) {
            throw BrsError.typeMismatch({
                message: "Attempting to retrieve property from non-iterable value",
                line: expression.closingSquare.line,
                left: source
            });
            return BrsInvalid.Instance;
        }

        let index = await this.evaluate(expression.index);
        if (!isBrsNumber(index) && !isBrsString(index)) {
            throw BrsError.typeMismatch({
                message: "Attempting to retrieve property from iterable with illegal index type",
                line: expression.closingSquare.line,
                left: source,
                right: index
            });
        }

        try {
            return source.get(index);
        } catch (err) {
            throw BrsError.make(err.message, expression.closingSquare.line);
        }
    }

    async visitGrouping(expr: Expr.Grouping) {
        return await this.evaluate(expr.expression);
    }

    async visitFor(statement: Stmt.For) {
        // BrightScript for/to loops evaluate the counter initial value, final value, and increment
        // values *only once*, at the top of the for/to loop.
        await this.execute(statement.counterDeclaration);
        const finalValue = await this.evaluate(statement.finalValue);
        const increment = await this.evaluate(statement.increment);

        const counterName = statement.counterDeclaration.name;
        const step = new Stmt.Assignment(
            counterName,
            new Expr.Binary(
                new Expr.Variable(counterName),
                { kind: Lexeme.Plus, text: "+", isReserved: false, line: counterName.line },
                new Expr.Literal(increment)
            )
        );

        let loopExitReason: Stmt.BlockEnd | undefined;

        while (
            (await this.evaluate(new Expr.Variable(counterName)))
                .equalTo(finalValue)
                .not()
                .toBoolean()
        ) {
            // execute the block
            try {
                await this.execute(statement.body);
            } catch (reason) {
                if (reason.kind === Stmt.StopReason.ExitFor) {
                    loopExitReason = reason as BlockEnd;
                    break;
                } else {
                    // re-throw returns, runtime errors, etc.
                    throw reason;
                }
            }

            // then increment the counter
            await this.execute(step);
        }

        // BrightScript for/to loops execute the body one more time when initial === final
        if (loopExitReason === undefined) {
            await this.execute(statement.body);
            // they also increments the counter once more
            await this.execute(step);
        }

        return BrsInvalid.Instance;
    }

    async visitForEach(statement: Stmt.ForEach) {
        let target = await this.evaluate(statement.target);
        if (!isIterable(target)) {
            throw BrsError.make(
                `Attempting to iterate across values of non-iterable type ` +
                    ValueKind.toString(target.kind),
                statement.item.line
            );
        }

        for (let element of target.getElements()) {
            this.environment.define(Scope.Function, statement.item.text!, element);

            // execute the block
            try {
                await this.execute(statement.body);
            } catch (reason) {
                if (reason.kind === Stmt.StopReason.ExitFor) {
                    break;
                } else {
                    // re-throw returns, runtime errors, etc.
                    throw reason;
                }
            }
        }

        return BrsInvalid.Instance;
    }

    async visitWhile(statement: Stmt.While) {
        while ((await this.evaluate(statement.condition)).equalTo(BrsBoolean.True).toBoolean()) {
            try {
                await this.execute(statement.body);
            } catch (reason) {
                if (reason.kind && reason.kind === Stmt.StopReason.ExitWhile) {
                    break;
                } else {
                    // re-throw returns, runtime errors, etc.
                    throw reason;
                }
            }
        }

        return BrsInvalid.Instance;
    }

    async visitIf(statement: Stmt.If) {
        if ((await this.evaluate(statement.condition)).equalTo(BrsBoolean.True).toBoolean()) {
            await this.execute(statement.thenBranch);
            return BrsInvalid.Instance;
        } else {
            for (const elseIf of statement.elseIfs || []) {
                if ((await this.evaluate(elseIf.condition)).equalTo(BrsBoolean.True).toBoolean()) {
                    await this.execute(elseIf.thenBranch);
                    return BrsInvalid.Instance;
                }
            }

            if (statement.elseBranch) {
                await this.execute(statement.elseBranch);
            }

            return BrsInvalid.Instance;
        }
    }

    visitAnonymousFunction(func: Expr.Function): BrsType {
        return toCallable(func);
    }

    visitLiteral(expression: Expr.Literal): BrsType {
        return expression.value;
    }

    async visitArrayLiteral(expression: Expr.ArrayLiteral) {
        return new BrsArray(
            await Promise.all(expression.elements.map(expr => this.evaluate(expr)))
        );
    }

    async visitAALiteral(expression: Expr.AALiteral) {
        return new AssociativeArray(
            await Promise.all(
                expression.elements.map(async member => ({
                    name: member.name,
                    value: await this.evaluate(member.value)
                }))
            )
        );
    }

    visitLogical(expression: Expr.Logical) {
        return BrsInvalid.Instance;
    }
    visitM(expression: Expr.M) {
        return BrsInvalid.Instance;
    }

    async visitDottedSet(statement: Stmt.DottedSet) {
        let source = await this.evaluate(statement.obj);
        let value = await this.evaluate(statement.value);

        if (!isIterable(source)) {
            throw BrsError.typeMismatch({
                message: "Attempting to set property on non-iterable value",
                line: statement.name.line,
                left: source
            });
            return BrsInvalid.Instance;
        }

        try {
            source.set(new BrsString(statement.name.text), value);
        } catch (err) {
            throw BrsError.make(err.message, statement.name.line);
        }

        return BrsInvalid.Instance;
    }

    async visitIndexedSet(statement: Stmt.IndexedSet) {
        let source = await this.evaluate(statement.obj);

        if (!isIterable(source)) {
            BrsError.typeMismatch({
                message: "Attempting to set property on non-iterable value",
                line: statement.closingSquare.line,
                left: source
            });
            return BrsInvalid.Instance;
        }

        let index = await this.evaluate(statement.index);
        if (!isBrsNumber(index) && !isBrsString(index)) {
            BrsError.typeMismatch({
                message: "Attempting to set property on iterable with illegal index type",
                line: statement.closingSquare.line,
                left: source,
                right: index
            });

            return BrsInvalid.Instance;
        }

        let value = await this.evaluate(statement.value);

        try {
            source.set(index, value);
        } catch (err) {
            throw BrsError.make(err.message, statement.closingSquare.line);
        }

        return BrsInvalid.Instance;
    }

    async visitUnary(expression: Expr.Unary) {
        let right = await this.evaluate(expression.right);

        switch (expression.operator.kind) {
            case Lexeme.Minus:
                if (isBrsNumber(right)) {
                    return right.multiply(new Int32(-1));
                } else {
                    BrsError.make(
                        `Attempting to negate non-numeric value.
                        value type: ${ValueKind.toString(right.kind)}`,
                        expression.operator.line
                    );
                    return BrsInvalid.Instance;
                }
            case Lexeme.Not:
                if (isBrsBoolean(right)) {
                    return right.not();
                } else {
                    BrsError.make(
                        `Attempting to NOT non-boolean value.
                        value type: ${ValueKind.toString(right.kind)}`,
                        expression.operator.line
                    );
                    return BrsInvalid.Instance;
                }
        }

        return BrsInvalid.Instance;
    }

    visitVariable(expression: Expr.Variable) {
        try {
            return this.environment.get(expression.name);
        } catch (err) {
            if (err instanceof NotFound) {
                return Uninitialized.Instance;
            }

            throw err;
        }
    }

    evaluate(this: Interpreter, expression: Expr.Expression): BrsType | Promise<BrsType> {
        return expression.accept<BrsType>(this);
    }

    execute(this: Interpreter, statement: Stmt.Statement): BrsType | Promise<BrsType> {
        return statement.accept<BrsType>(this);
    }
}
