import * as vscode from "vscode";
const MAX_ITERATIONS = 20; //最大循环次数,用于兜底ai调用,防止死循环
let iterations = 0;//当前次数

export function getConfig() {
    const config = vscode.workspace.getConfiguration('soul-agent');
    const baseUrl = config.get<string>('baseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const apiKey = config.get<string>('apiKey', '');
    const model = config.get<string>('model');
    return { baseUrl, apiKey, model };
}

export async function completion(messages: any[], tools?: any[]): Promise<any> {

    const { baseUrl, apiKey, model } = getConfig();

    if (!apiKey) {
        throw new Error('请先在设置里填写 API Key');
    }

    const response = await fetch(
        baseUrl,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                tools,
                tool_choice: 'auto',

            })
        }
    );

    const data = await response.json();
    console.log(data.choices[0].message.content);
    return data.choices[0].message;
}