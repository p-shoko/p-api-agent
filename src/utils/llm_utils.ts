import { jsonrepair } from 'jsonrepair'
class _LLM_Utils {

    /**
     * 提取大模型返回的markdown
     */
    extract_markdown(content) {
        //@ts-ignore
        const regex = /```markdown\n(.*?)\n```/s;
        const match = content.match(regex)
        if (!match) return content
        return match[1]
    }



    /**
     * 提取大模型的json格式
     */
    extract_json(content) {
        //@ts-ignore
        const regex = /```json\n(.*?)\n```/s;
        const match = content.match(regex)
        let json_content = match ? match[1] : content

        try {
            return JSON.parse(json_content)
        }
        catch (err) {
            return JSON.parse(jsonrepair(json_content))
        }
    }


    /**
     * 提取mermaid格式
     */
    extract_mermaid(content) {
        //@ts-ignore
        const regex = /```mermaid\n(.*?)\n```/s;
        const match = content.match(regex)
        if (!match) return content
        return match[1]
    }


    /**
     * 提取svg格式
     */
    extract_svg(content) {
        //@ts-ignore
        const regex = /```svg\n(.*?)\n```/s;
        const match = content.match(regex)
        if (!match) return content
        return match[1]
    }

    parse_json(content: string | object): any {
        if (typeof content === 'object') {
            return content;
        }
        try {
            return JSON.parse(content)
        }
        catch (err) {
            return JSON.parse(jsonrepair(content))
        }
    }
}

export const LLM_Utils = new _LLM_Utils()