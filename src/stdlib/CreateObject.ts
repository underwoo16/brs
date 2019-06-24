import { Callable, ValueKind, BrsInvalid, BrsString, BrsType, StdlibArgument } from "../brsTypes";
import { BrsObjects } from "../brsTypes/components/BrsObjects";
import * as Expr from "../parser/Expression";
import { Interpreter } from "../interpreter";

/** Creates a new instance of a given brightscript component (e.g. roAssociativeArray) */
export const CreateObject = new Callable("CreateObject", {
    signature: {
        args: [
            new StdlibArgument("objName", ValueKind.String),
            new StdlibArgument("arg1", ValueKind.Dynamic, BrsInvalid.Instance),
            new StdlibArgument("arg2", ValueKind.Dynamic, BrsInvalid.Instance),
            new StdlibArgument("arg3", ValueKind.Dynamic, BrsInvalid.Instance),
            new StdlibArgument("arg4", ValueKind.Dynamic, BrsInvalid.Instance),
        ],
        returns: ValueKind.Dynamic,
    },
    impl: (interpreter: Interpreter, objName: BrsString, ...additionalArgs: BrsType[]) => {
        let objToCreate = objName.value.toLowerCase();

        let possibleMock = interpreter.environment.getMock(objToCreate);
        if (!(possibleMock instanceof BrsInvalid)) {
            return possibleMock;
        }

        let ctor = BrsObjects.get(objToCreate);
        return ctor ? ctor(...additionalArgs) : BrsInvalid.Instance;
    },
});
