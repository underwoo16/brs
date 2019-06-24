import {
    BrsType,
    ValueKind,
    Callable,
    BrsString,
    StdlibArgument,
    BrsInvalid,
    RoAssociativeArray,
} from "../brsTypes";
import { Interpreter } from "../interpreter";

let mockComponent = new Callable("mockComponent", {
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

export const _brs_ = new RoAssociativeArray([
    { name: new BrsString("mockComponent"), value: mockComponent },
]);
