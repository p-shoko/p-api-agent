import { FunctionCall } from "../function_call"
import fs from 'fs'
import { LLM_Utils } from "../utils/llm_utils"
import path from "path"

interface TextContent {
    type: 'text'
    text: string
}
interface ImageContent {
    type: 'image_url'
    image_url: { url: string }
}

type Content = TextContent | ImageContent

export type Message = { role: 'system' | 'user' | 'assistant'; content: Content[] }
export type UserChatInput = Message[]

/**
 * LLM 每轮只能输出以下三种指令之一
 *
 *  end        - 任务结束，直接返回最终答案给用户
 *  use_tool   - 调用某个工具函数
 *  no_ability - 无法处理当前请求
 */
type AgentCommand =
    | { command: 'end'; result: string }
    | { command: 'use_tool'; tool_name: string; params: Record<string, any>; reasoning?: string }
    | { command: 'no_ability'; result: string }

export interface ToolRecord {
    tool_name: string
    params: any
    exec_result: any
}

export interface CreateChatResult {
    result: string
    use_tools: ToolRecord[]
}

export interface AgentOptions {
    /** 最大推理循环次数，默认 20 */
    maxLoop?: number
    /** LLM 失败重试次数，默认 2 */
    retryTimes?: number
    /** 完全覆盖系统提示词 */
    customSystemPrompt?: string
}


export class Agent {

    private function_call: FunctionCall | null = null
    private llm_chat_func: ((input: UserChatInput) => Promise<string>) | null = null

    private max_loop: number
    private retry_times: number
    private custom_system_prompt: string | null = null

    constructor(options: AgentOptions = {}) {
        this.max_loop = options.maxLoop ?? 20
        this.retry_times = options.retryTimes ?? 2
        if (options.customSystemPrompt) {
            this.custom_system_prompt = options.customSystemPrompt
        }
    }

    // ─────────── Registration ───────────

    /** 注册工具函数集合，支持链式调用 */
    public register_function_call(fc: FunctionCall): this {
        this.function_call = fc
        return this
    }

    /** 注册 LLM 文字能力，支持链式调用 */
    public register_llm_text_ability(func: (input: UserChatInput) => Promise<string>): this {
        this.llm_chat_func = func
        return this
    }

    /** 覆盖系统提示词 */
    public set_system_prompt(prompt: string): this {
        this.custom_system_prompt = prompt
        return this
    }

    /** 动态修改最大循环次数 */
    public set_max_loop(n: number): this {
        this.max_loop = n
        return this
    }

    // ─────────── Main ReAct Loop ───────────

    /**
     * 发起对话。
     *
     * 架构：ReAct 单调用循环
     *   每轮只调用一次 LLM，LLM 在拥有完整工具 schema 的系统提示词下
     *   直接输出 end / use_tool / no_ability 三种指令，
     *   彻底消除了旧版 "判断→查文档→生成参数→再生成答案" 的多次调用开销。
     */
    public async create_chat(user_input: string | UserChatInput): Promise<CreateChatResult> {
        if (!this.llm_chat_func) {
            return { result: '未注册LLM能力', use_tools: [] }
        }

        // 对话历史（不含 system）
        const history: UserChatInput = this.normalize_input(user_input)

        // 每次调用都用最新工具列表重新构建系统提示词
        const system_msg: Message = {
            role: 'system',
            content: [{ type: 'text', text: this.build_system_prompt() }]
        }

        const result: CreateChatResult = { result: '', use_tools: [] }
        const tool_fail_count: Record<string, number> = {}

        for (let turn = 0; turn < this.max_loop; turn++) {

            // ── 单次 LLM 调用 ──
            let raw: string
            try {
                raw = await this.call_llm_with_retry([system_msg, ...history])
            } catch (err: any) {
                result.result = `LLM调用失败: ${err?.message ?? String(err)}`
                return result
            }

            // ── 解析指令 ──
            const cmd = this.parse_command(raw)

            // 无法解析时视为最终自然语言答案
            if (!cmd) {
                result.result = raw
                return result
            }

            // ── end：任务完成 ──
            if (cmd.command === 'end') {
                result.result = cmd.result
                return result
            }

            // ── no_ability：无法处理 ──
            if (cmd.command === 'no_ability') {
                result.result = cmd.result || '无法执行此操作'
                return result
            }

            // ── use_tool：调用工具 ──
            if (cmd.command === 'use_tool') {
                const { tool_name, params } = cmd

                if (!this.function_call) {
                    result.result = '未注册工具函数集合，无法执行工具调用'
                    return result
                }

                // 将 LLM 的 use_tool 决策记入历史（assistant 角色）
                history.push({
                    role: 'assistant',
                    content: [{ type: 'text', text: raw }]
                })

                // 执行工具
                let tool_result: any
                try {
                    tool_result = await this.function_call.exec_function(tool_name, params)
                } catch (err: any) {
                    const err_msg = err?.message ?? String(err)
                    tool_fail_count[tool_name] = (tool_fail_count[tool_name] ?? 0) + 1

                    // 把错误作为 observation 注入，让 LLM 自行决定下一步
                    history.push({
                        role: 'user',
                        content: [{
                            type: 'text',
                            text: `[工具执行失败] ${tool_name}\n错误信息: ${err_msg}\n请根据错误调整策略后继续`
                        }]
                    })

                    if (tool_fail_count[tool_name] >= 2) {
                        result.result = `工具 "${tool_name}" 连续调用失败，请稍后重试`
                        return result
                    }
                    continue
                }

                // 把工具结果作为 observation 注入历史（user 角色）
                history.push({
                    role: 'user',
                    content: [{
                        type: 'text',
                        text: `[工具调用结果] ${tool_name}\n${JSON.stringify(tool_result, null, 2)}`
                    }]
                })

                result.use_tools.push({ tool_name, params, exec_result: tool_result })
                // 继续下一轮推理
                continue
            }
        }

        result.result = '超出最大推理轮次，请精简问题后重试'
        return result
    }

    // ─────────── System Prompt ───────────

    /**
     * 构建系统提示词。
     * 将所有工具的完整 schema（含参数类型、必填项、示例值）
     * 直接注入系统提示词，让 LLM 在单次调用中就能做出准确的工具选择和参数填写。
     */
    private build_system_prompt(): string {
        if (this.custom_system_prompt) return this.custom_system_prompt

        const base = this.load_preset_prompt()
        if (!this.function_call) return base

        const tool_schemas = this.function_call.get_tools_with_schema()
            .map(t => {
                const props = Object.entries(t.input_schema.properties)
                    .map(([k, v]: [string, any]) => {
                        const req = t.input_schema.required?.includes(k) ? '必填' : '可选'
                        const ex = v.examples?.length ? `，示例: ${v.examples.join(' / ')}` : ''
                        return `    - ${k} (${v.type}, ${req}): ${v.description}${ex}`
                    }).join('\n')
                return `### ${t.name}\n描述: ${t.description}\n参数:\n${props}`
            })
            .join('\n\n')

        return `${base}\n\n## 可用工具列表\n\n${tool_schemas}`
    }

    private load_preset_prompt(): string {
        try {
            return fs.readFileSync(path.join(__dirname, './preset_prompt.md'), 'utf-8')
        } catch {
            return ''
        }
    }

    // ─────────── Helpers ───────────

    private normalize_input(input: string | UserChatInput): UserChatInput {
        if (typeof input === 'string') {
            return [{ role: 'user', content: [{ type: 'text', text: input }] }]
        }
        return [...input]
    }

    private parse_command(raw: string): AgentCommand | null {
        const normalized = this.normalize_llm_output(raw)
        const json = this.safe_extract_json(normalized)
        if (!json) return null

        if (typeof json.command === 'string') {
            return json as AgentCommand
        }

        return this.adapt_common_tool_call(json)
    }

    private safe_extract_json(content: string): any | null {
        try {
            return LLM_Utils.extract_json(content)
        } catch {
            const json_candidate = this.find_first_json_block(content)
            if (!json_candidate) return null
            try {
                return LLM_Utils.parse_json(json_candidate)
            } catch {
                return null
            }
        }
    }

    /**
     * 兼容部分模型返回的函数调用包裹标记，例如：
     * <|FunctionCallBegin|> ... <|FunctionCallEnd|>
     */
    private normalize_llm_output(raw: string): string {
        return raw
            .replace(/<\|FunctionCallBegin\|>/gi, '')
            .replace(/<\|FunctionCallEnd\|>/gi, '')
            .replace(/<\|tool_call\|>/gi, '')
            .replace(/<tool_call>/gi, '')
            .replace(/<\/tool_call>/gi, '')
            .trim()
    }

    /** 从混杂文本中提取第一个 JSON 对象字符串 */
    private find_first_json_block(content: string): string | null {
        const fenced = content.match(/```json\s*([\s\S]*?)\s*```/i)
        if (fenced?.[1]) return fenced[1]

        const objectStart = content.indexOf('{')
        const arrayStart = content.indexOf('[')

        let start = -1
        let openChar = '{'
        let closeChar = '}'

        if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
            start = objectStart
            openChar = '{'
            closeChar = '}'
        } else if (arrayStart >= 0) {
            start = arrayStart
            openChar = '['
            closeChar = ']'
        }

        if (start < 0) return null

        let depth = 0
        let inString = false
        let escaped = false

        for (let i = start; i < content.length; i++) {
            const ch = content[i]

            if (inString) {
                if (escaped) {
                    escaped = false
                    continue
                }
                if (ch === '\\') {
                    escaped = true
                    continue
                }
                if (ch === '"') {
                    inString = false
                }
                continue
            }

            if (ch === '"') {
                inString = true
                continue
            }

            if (ch === openChar) depth++
            if (ch === closeChar) {
                depth--
                if (depth === 0) {
                    return content.slice(start, i + 1)
                }
            }
        }
        return null
    }

    /** 兼容常见 Function Calling 输出结构并转换为内部指令 */
    private adapt_common_tool_call(json: any): AgentCommand | null {
        // 结构0：数组包裹 [{ name, arguments }] / [{ function: { ... } }]
        if (Array.isArray(json) && json.length > 0) {
            return this.adapt_common_tool_call(json[0])
        }

        // 结构1：{ name, arguments }
        if (typeof json?.name === 'string') {
            const params = this.normalize_params(json.params ?? json.arguments ?? json.parameters ?? {})
            return {
                command: 'use_tool',
                tool_name: json.name,
                params,
                reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined
            }
        }

        // 结构2：{ function: { name, arguments } }
        if (typeof json?.function?.name === 'string') {
            const params = this.normalize_params(json.function.arguments ?? json.function.parameters ?? {})
            return {
                command: 'use_tool',
                tool_name: json.function.name,
                params,
                reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined
            }
        }

        // 结构3：{ tool_calls: [{ function: { name, arguments } }] }
        const first_tool_call = Array.isArray(json?.tool_calls) ? json.tool_calls[0] : null
        if (typeof first_tool_call?.function?.name === 'string') {
            const params = this.normalize_params(first_tool_call.function.arguments ?? first_tool_call.function.parameters ?? {})
            return {
                command: 'use_tool',
                tool_name: first_tool_call.function.name,
                params,
                reasoning: typeof json.reasoning === 'string' ? json.reasoning : undefined
            }
        }

        return null
    }

    private normalize_params(params: any): Record<string, any> {
        if (params == null) return {}
        if (typeof params === 'string') {
            try {
                const parsed = LLM_Utils.parse_json(params)
                return typeof parsed === 'object' && parsed ? parsed : { value: parsed }
            } catch {
                return { value: params }
            }
        }
        if (typeof params === 'object') return params
        return { value: params }
    }

    private async call_llm_with_retry(input: UserChatInput): Promise<string> {
        let last_error: any
        for (let i = 0; i <= this.retry_times; i++) {
            try {
                const res = await this.llm_chat_func!(input)
                if (typeof res === 'string' && res.trim()) return res
                throw new Error('空响应')
            } catch (err) {
                last_error = err
            }
        }
        throw last_error ?? new Error('LLM调用失败')
    }
}