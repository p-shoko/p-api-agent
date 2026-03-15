import path from "path";
import fs from 'fs'

export interface RegisterInfo {
    name: string;
    description: string;
    input_schema: {
        type: string;
        properties: {
            [key: string]: {
                type: string;
                description: string;
                examples?: string[];
            };
        };
        required?: string[];
    };
    register_func: (...args: any[]) => Promise<any>;
}


export class FunctionCall {

    private tools: { [key: string]: RegisterInfo } = {}

    constructor(public tool_path: string) {
        this.init()
    }

    private init() {
        for (const file_name of fs.readdirSync(this.tool_path)) {
            const route_path = path.join(this.tool_path, file_name);
            const mcp = require(route_path)
            const info: RegisterInfo = mcp.register()
            this.tools[info.name] = info
        }
    }

    /**
     * 生成完整的工具函数说明文档
     */
    public gen_tool_doc(name: string) {
        const info = this.tools[name]
        if (!info) {
            throw `${name}工具函数不存在`
        }
        const schema = info.input_schema
        const schemaDesc = `类型: ${schema.type}`
        const params = Object.keys(schema.properties).map(key => {
            const item = schema.properties[key]
            const required = schema.required?.includes(key) ? '必填' : '可选'
            const examples = item.examples && item.examples.length > 0
                ? `示例值: ${item.examples.join(', ')}`
                : '无示例'
            return `  - ${key} (${item.type}, ${required})\n    说明: ${item.description}\n    ${examples}`
        }).join('\n')

        return `工具函数名称: ${info.name}\n功能描述: ${info.description}\n输入结构: ${schemaDesc}\n参数列表:\n${params}`
    }





    /**
     * 获取工具函数列表（仅名称 + 描述）
     */
    public get_tools_list() {
        return Object.keys(this.tools).map(key => {
            const info = this.tools[key]
            return {
                name: info.name,
                description: info.description,
            }
        })
    }

    /**
     * 获取工具函数列表（含完整 input_schema），供 Agent 注入系统提示词
     */
    public get_tools_with_schema() {
        return Object.keys(this.tools).map(key => {
            const info = this.tools[key]
            return {
                name: info.name,
                description: info.description,
                input_schema: info.input_schema,
            }
        })
    }


    /**
     * 执行工具函数
     */
    public async exec_function(name: string, params: any) {
        const info = this.tools[name]
        if (!info) {
            throw `工具函数${name}不存在`
        }
        return await info.register_func(params)
    }

}

