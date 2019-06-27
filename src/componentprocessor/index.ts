import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import xmldoc, { XmlDocument } from "xmldoc";
import pSettle = require("p-settle");
const readFile = promisify(fs.readFile);
import * as fg from "fast-glob";

interface FieldAttributes {
    id: string;
    type: string;
    alias?: string;
    value?: string;
    onChange?: string;
    alwaysNotify?: string;
}

interface ComponentField {
    [key: string]: FieldAttributes;
}

export class ComponentDefinition {
    public contents?: string;
    public xmlNode?: XmlDocument;
    public name?: string;
    // indicates whether this component heirarchy has been processed before
    // which means the fields, children, and inherited functions are correctly set
    public processed: boolean = false;
    public fields: ComponentField = {};

    constructor(readonly xmlPath: string) {}

    async parse(): Promise<ComponentDefinition> {
        let contents;
        try {
            contents = await readFile(this.xmlPath, "utf-8");
            let xmlStr = contents.toString().replace(/\r?\n|\r/g, "");
            this.xmlNode = new xmldoc.XmlDocument(xmlStr);
            this.name = this.xmlNode.attr.name;

            return Promise.resolve(this);
        } catch (err) {
            console.log("some error");
            console.log(err);
            // TODO: provide better parse error reporting
            //   cases:
            //     * file read error
            //     * XML parse error
            return Promise.reject(this);
        }
    }
}

export function getComponentDefinitionMap(rootDir: string) {
    const componentsPattern = rootDir + "/components/**/*.xml";
    const xmlFiles: string[] = fg.sync(componentsPattern, {});

    let defs = xmlFiles.map(file => new ComponentDefinition(file));
    let parsedPromises = defs.map(async def => def.parse());

    return processXmlTree(pSettle(parsedPromises));
}

async function processXmlTree(
    settledPromises: Promise<pSettle.SettledResult<ComponentDefinition>[]>
) {
    let nodeDefs = await settledPromises;
    let nodeDefMap = new Map<string, ComponentDefinition>();

    // create map of just ComponentDefinition objects
    nodeDefs.map(node => {
        if (node.isFulfilled && !node.isRejected) {
            nodeDefMap.set(node.value!.name!, node.value!);
        }
    });

    // recursively create an inheritance stack for each component def and build up
    // the component backwards from most extended component first
    let inheritanceStack: ComponentDefinition[] = [];

    nodeDefMap.forEach((node, nodeName) => {
        if (node && node.processed === false) {
            let xmlNode = node.xmlNode;
            inheritanceStack.push(node);
            //builds inheritance stack
            while (xmlNode && xmlNode.attr.extends) {
                let superNode = nodeDefMap.get(xmlNode.attr.extends);
                if (superNode) {
                    inheritanceStack.push(superNode);
                    xmlNode = superNode.xmlNode;
                } else {
                    xmlNode = undefined;
                }
            }

            let inheritedFields: ComponentField = {};
            // pop the stack & build our component
            // we can safely assume nodes are valid ComponentDefinition objects
            while (inheritanceStack.length > 0) {
                let newNode = inheritanceStack.pop();
                if (newNode) {
                    if (newNode.processed) {
                        inheritedFields = newNode.fields;
                    } else {
                        let nodeFields = getFields(newNode.xmlNode!);
                        // we will get run-time error if any fields are duplicated
                        // between inherited components, but here we will retain
                        // the original value without throwing an error for simplicity
                        inheritedFields = { ...nodeFields, ...inheritedFields };
                        newNode.fields = inheritedFields;
                        newNode.processed = true;
                    }
                }
            }
        }
    });

    return nodeDefMap;
}

function getFields(node: XmlDocument): ComponentField {
    let iface = node.childNamed("interface");
    let fields: ComponentField = {};

    if (!iface) {
        return fields;
    }

    iface.eachChild(child => {
        if (child.name === "field") {
            fields[child.attr.id] = {
                type: child.attr.type,
                id: child.attr.id,
                alias: child.attr.alias,
                onChange: child.attr.onChange,
                alwaysNotify: child.attr.alwaysNotify,
                value: child.attr.value,
            };
        }
    });

    return fields;
}
