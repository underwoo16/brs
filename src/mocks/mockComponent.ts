import {
    BrsType,
    ValueKind,
    Callable,
    BrsString,
    StdlibArgument,
    BrsInvalid,
    RoAssociativeArray,
    RoSGNode,
} from "../brsTypes";
import { Interpreter } from "../interpreter";
import { AAMember, Call } from "../parser/Expression";

let mockComponent = new Callable("mockComponent", {
    signature: {
        args: [
            new StdlibArgument("objToMock", ValueKind.String),
            new StdlibArgument("mock", ValueKind.Object),
        ],
        returns: ValueKind.Dynamic,
    },
    impl: (interpreter: Interpreter, objToMock: BrsType, mock: RoAssociativeArray) => {
        let mockNode = new RoSGNode([]);
        let mockElements = mock.getValue();
        mockElements.forEach((value: BrsType, key: string) => {
            if (value instanceof Callable) {
                // register callable method on mockNode
                mockNode.registerMethod(key, value);
            } else {
                // add field to mockNode
                mockNode.set(new BrsString(key), value);
            }
        });
        interpreter.environment.setMock(objToMock.toString(), mockNode);
        return BrsInvalid.Instance;
    },
});

export const _brs_ = new RoAssociativeArray([
    { name: new BrsString("mockComponent"), value: mockComponent },
]);
