import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import xmldoc, { XmlDocument } from "xmldoc";
import pSettle = require("p-settle");
const readFile = promisify(fs.readFile);
const fg = require("fast-glob");

export class ComponentDefinition {
    public contents?: string;
    public isFulfilled: boolean = true;

    constructor(readonly xmlPath: string) {}

    async parse(): Promise<XmlDocument | string> {
        let contents;
        try {
            contents = await readFile(this.xmlPath, "utf-8");
            let xmlStr = contents.toString();
            let xmlNode = new xmldoc.XmlDocument(xmlStr);

            return Promise.resolve(xmlNode);
        } catch (err) {
            console.log("some error");
            console.log(err);
            // TODO: provide better parse error reporting
            //   cases:
            //     * file read error
            //     * XML parse error
            return Promise.reject("error");
            // return Promise.reject({
            //     message: "Error parsing XML: " + this.xmlPath
            // });
        }
    }
}

export async function getComponentDefinitions(rootDir: string): Promise<Object[]> {
    const componentsPattern = rootDir + "/components/**/*.xml";
    const xmlFiles: string[] = fg.sync(componentsPattern, {});

    let defs = xmlFiles.map(file => new ComponentDefinition(file));
    let parsedPromises = defs.map(async def => def.parse());

    return pSettle(parsedPromises);
}
