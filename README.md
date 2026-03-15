# p-api-agent

一个轻量、高效、模型无关的 LLM Agent 框架。

采用 **ReAct 单调用循环**架构：每轮推理只发起一次 LLM 调用，通过将完整工具 Schema 注入系统提示词，让模型在单次响应中完成「是否用工具 + 选哪个工具 + 填什么参数」三步决策，相比传统多步判断方案减少 60% 以上的 API 调用次数。

## 特性

- ⚡ **ReAct 单调用循环** — 每轮只调用一次 LLM，无冗余中间步骤
- 🔌 **模型无关** — 只需注册一个 `async (messages) => string` 函数，兼容任意 LLM（OpenAI / Claude / 豆包 / 通义 / DeepSeek …）
- 🔧 **动态工具注册** — 工具以独立文件方式组织，按目录自动加载
- 🔗 **链式 API** — 注册方法均返回 `this`，支持链式调用
- 🛡️ **完善容错** — LLM 重试、工具失败兜底、JSON 解析保护、循环上限防护
- 📦 **零侵入** — 不绑定任何 LLM SDK，按需引入

---

## 安装

```bash
npm install p-api-agent
# 或
pnpm add p-api-agent
# 或
yarn add p-api-agent
```

---

## 快速开始

```typescript
import { Agent, FunctionCall } from 'p-api-agent';
import path from 'path';

const agent = new Agent({ maxLoop: 10 });

// 1. 注册 LLM 能力（替换成你自己的 LLM 调用）
agent.register_llm_text_ability(async (messages) => {
  const res = await yourLLMClient.chat(messages);
  return res.content;
});

// 2. 注册工具函数目录（可选）
const fc = new FunctionCall(path.join(__dirname, 'tools'));
agent.register_function_call(fc);

// 3. 发起对话
const result = await agent.create_chat('帮我查一下订单 12345 的收货地址');
console.log(result.result);     // 最终答案
console.log(result.use_tools);  // 调用过的工具记录
```

支持链式注册：

```typescript
const result = await new Agent({ maxLoop: 10 })
  .register_llm_text_ability(llmFunc)
  .register_function_call(fc)
  .create_chat('你好');
```

---

## 工作原理

```
用户输入
  │
  ▼
构建系统提示词（含所有工具完整 Schema）
  │
  ▼  ◄────────────────────────────────────────────────────────┐
单次 LLM 调用                                                  │
  │                                                            │
  ├─ { command: "use_tool", tool_name, params }                │
  │       └─ 执行工具 → 结果作为 observation 注入历史 ──────────┘
  │
  ├─ { command: "end", result }
  │       └─ 返回最终答案 ✓
  │
  └─ { command: "no_ability", result }
          └─ 返回无法处理说明 ✓
```

每轮推理固定 **1 次** LLM 调用。工具结果以 `[工具调用结果]` 前缀注入对话历史，模型可在下一轮基于结果继续推理、链式调用多个工具，最终输出 `end` 指令结束。

---

## 创建工具函数

在工具目录下为每个工具创建一个独立文件，导出 `register()` 函数：

```typescript
// tools/get_weather.ts
import type { RegisterInfo } from 'p-api-agent';

export const register = (): RegisterInfo => ({
  name: 'get_weather',
  description: '获取指定城市的实时天气信息',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称',
        examples: ['北京', '上海', '深圳'],
      },
      date: {
        type: 'string',
        description: '日期，格式 YYYY-MM-DD，不传则默认今天',
      },
    },
    required: ['city'],
  },
  register_func: async (params: { city: string; date?: string }) => {
    // 实现你的业务逻辑
    return { city: params.city, temperature: 25, weather: '晴' };
  },
});
```

`register_func` 接收 LLM 生成的参数对象，返回值会被序列化后注入对话上下文供模型读取。

---

## API 文档

### `new Agent(options?)`

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `maxLoop` | `number` | `20` | 最大推理循环轮次，防止无限循环 |
| `retryTimes` | `number` | `2` | LLM 调用失败时的重试次数 |
| `customSystemPrompt` | `string` | — | 完全覆盖内置系统提示词 |

---

### `agent.register_llm_text_ability(func)`

注册 LLM 文字调用函数，返回 `this`。

```typescript
agent.register_llm_text_ability(
  async (messages: Message[]) => Promise<string>
)
```

`messages` 格式遵循 OpenAI Chat Completions 标准，兼容绝大多数主流 LLM。

---

### `agent.register_function_call(fc)`

注册工具函数集合，返回 `this`。`FunctionCall` 会自动扫描目录下所有文件并调用 `register()` 加载。

```typescript
const fc = new FunctionCall('/absolute/path/to/tools');
agent.register_function_call(fc);
```

---

### `agent.create_chat(input)`

发起一轮对话，返回 `Promise<CreateChatResult>`。

```typescript
// 字符串输入
const result = await agent.create_chat('查询用户 123 的信息');

// 消息数组输入（携带多轮历史）
const result = await agent.create_chat([
  { role: 'user', content: [{ type: 'text', text: '你好' }] },
  { role: 'assistant', content: [{ type: 'text', text: '你好！' }] },
  { role: 'user', content: [{ type: 'text', text: '帮我查一下...' }] },
]);
```

**返回值：**

```typescript
interface CreateChatResult {
  result: string       // 最终返回给用户的文本答案
  use_tools: {         // 本次对话中调用过的工具记录
    tool_name: string
    params: any
    exec_result: any
  }[]
}
```

---

### `agent.set_system_prompt(prompt)`

运行时覆盖系统提示词，返回 `this`。**注意：** 覆盖后工具列表不再自动注入，需在自定义提示词中手动声明。

---

### `agent.set_max_loop(n)`

动态调整最大循环轮次，返回 `this`。

---

### `new FunctionCall(toolPath)`

| 方法 | 说明 |
|---|---|
| `get_tools_list()` | 返回工具名称 + 描述列表 |
| `get_tools_with_schema()` | 返回工具完整 Schema（含参数定义） |
| `gen_tool_doc(name)` | 生成单个工具的可读说明文档字符串 |
| `exec_function(name, params)` | 执行指定工具，返回工具执行结果 |

---

## 类型定义

```typescript
import type {
  AgentOptions,
  UserChatInput,
  Message,
  CreateChatResult,
  ToolRecord,
  RegisterInfo,
} from 'p-api-agent';
```

---

## 完整示例（OpenAI）

```typescript
import { Agent, FunctionCall } from 'p-api-agent';
import OpenAI from 'openai';
import path from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const agent = new Agent({ maxLoop: 15, retryTimes: 3 })
  .register_llm_text_ability(async (messages) => {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages as any,
    });
    return res.choices[0].message.content ?? '';
  })
  .register_function_call(
    new FunctionCall(path.join(__dirname, 'tools'))
  );

const { result, use_tools } = await agent.create_chat(
  '帮我查询订单 12345 的购买者信息和商品价格'
);

console.log('答案:', result);
console.log('调用了工具:', use_tools.map(t => t.tool_name));
```

---

## 自定义系统提示词

如需完全控制 Agent 人设，使用 `customSystemPrompt` 选项：

```typescript
const agent = new Agent({
  customSystemPrompt: `
你是一个专业的电商客服助手，负责处理订单查询和退换货问题。

## 指令格式
每次只能输出以下 JSON 之一，不能附带多余文字：
- 调用工具: {"command":"use_tool","tool_name":"工具名","params":{...}}
- 任务完成: {"command":"end","result":"最终答案"}
- 无法处理: {"command":"no_ability","result":"原因说明"}

## 可用工具
- get_order_info: 根据订单号查询订单详情
- get_user_info: 根据用户 ID 查询用户信息
  `.trim(),
});
```

---

## 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 运行示例
npx tsx examples/test.ts
```

---

## License

ISC
