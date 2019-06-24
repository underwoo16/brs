import {
    BrsType,
    ValueKind,
    Callable,
    Int32,
    BrsString,
    StdlibArgument,
    RoArray,
    BrsInvalid,
} from "../brsTypes";
import * as Expr from "../parser/Expression";
import { Interpreter } from "../interpreter";

export const mockComponent = new Callable("mockComponent", {
    signature: {
        args: [
            new StdlibArgument("objToMock", ValueKind.String),
            new StdlibArgument("mock", ValueKind.Object),
        ],
        returns: ValueKind.Dynamic,
    },
    impl: (interpreter: Interpreter, objToMock: BrsType, mock: BrsType) => {
        interpreter.environment.setMock(objToMock.toString(), mock);
        return BrsInvalid.Instance;
    },
});
