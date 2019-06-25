const brs = require("brs");
const { ValueKind, Callable } = brs.types;
const { Interpreter } = require("../../lib/interpreter");
const { MockNode } = require("../../lib/mocks/MockNode");

describe("MockNode", () => {
    describe("methods", () => {
        let interpreter;

        beforeEach(() => {
            interpreter = new Interpreter();
            mockNode = new MockNode();
        });

        describe("registerNewMethod", () => {
            it("registers a new callable on the mock node", () => {
                newMethod = new Callable("newMethod", {
                    signature: {
                        args: [],
                        returns: ValueKind.Boolean,
                    },
                    impl: () => {
                        return true;
                    },
                });

                mockNode.registerNewMethod("newMethod", newMethod);
                result = mockNode.getMethod("newMethod");
                expect(result).toBeTruthy();
                expect(result.call(interpreter)).toBe(true);
            });
        });
    });
});
