import { RoSGNode, Callable } from "../brsTypes";

export class MockNode extends RoSGNode {
    constructor() {
        super([]);
    }

    registerNewMethod(index: string, method: Callable) {
        this.registerMethod(index, method);
    }
}
