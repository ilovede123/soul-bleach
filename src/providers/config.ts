/**
 * author:dengwei date:2026-07-18
 * 模型服务配置与密钥管理。普通配置保留在 VS Code Settings，API Key 使用 SecretStorage。
 */
import * as vscode from 'vscode';

export type ModelProvider = 'qwen' | 'zhipu-open' | 'zhipu-coding' | 'zai' | 'zhipu' | 'custom';
export type ModelPreset = 'provider-default' | 'qwen3.7-plus' | 'qwen3.7-max' | 'qwen-plus' | 'glm-5.2' | 'glm-5.2-1m' | 'glm-5.1' | 'glm-5' | 'glm-4.7' | 'glm-4.7-flash' | 'custom';

export type ModelConfig = {
    provider: ModelProvider;
    modelPreset: ModelPreset;
    baseUrl: string;
    apiKey: string;
    model: string;
    extraBody: Record<string, unknown>;
};

type RequestPreset = {
    baseUrl: string;
    model: string;
    extraBody?: Record<string, unknown>;
};

const API_KEY_SECRET = 'soul-bleach.apiKey';
const QWEN_EXTRA_BODY = { enable_thinking: false };
let secretStorage: vscode.SecretStorage | undefined;

const PROVIDER_PRESETS: Record<ModelProvider, RequestPreset> = {
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3.7-plus', extraBody: QWEN_EXTRA_BODY },
    'zhipu-open': { baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.2' },
    'zhipu-coding': { baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', model: 'glm-4.7' },
    zai: { baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-5.2' },
    zhipu: { baseUrl: 'https://api.z.ai/api/paas/v4/chat/completions', model: 'glm-5.2' },
    custom: { baseUrl: '', model: '' }
};

const MODEL_PRESETS: Record<Exclude<ModelPreset, 'provider-default'>, RequestPreset> = {
    'qwen3.7-plus': { baseUrl: PROVIDER_PRESETS.qwen.baseUrl, model: 'qwen3.7-plus', extraBody: QWEN_EXTRA_BODY },
    'qwen3.7-max': { baseUrl: PROVIDER_PRESETS.qwen.baseUrl, model: 'qwen3.7-max', extraBody: QWEN_EXTRA_BODY },
    'qwen-plus': { baseUrl: PROVIDER_PRESETS.qwen.baseUrl, model: 'qwen-plus', extraBody: QWEN_EXTRA_BODY },
    'glm-5.2': { baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl, model: 'glm-5.2' },
    'glm-5.2-1m': { baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl, model: 'glm-5.2[1m]' },
    'glm-5.1': { baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl, model: 'glm-5.1' },
    'glm-5': { baseUrl: PROVIDER_PRESETS['zhipu-open'].baseUrl, model: 'glm-5' },
    'glm-4.7': { baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl, model: 'glm-4.7' },
    'glm-4.7-flash': { baseUrl: PROVIDER_PRESETS['zhipu-coding'].baseUrl, model: 'glm-4.7-flash' },
    custom: { baseUrl: '', model: '' }
};

/** 初始化密钥存储，并迁移旧版 Settings 中的明文 API Key。 */
export async function initializeModelConfig(secrets: vscode.SecretStorage) {
    secretStorage = secrets;
    const config = vscode.workspace.getConfiguration('soul-bleach');
    const legacyKey = config.get<string>('apiKey', '');
    if (legacyKey && !(await secrets.get(API_KEY_SECRET))) {
        await secrets.store(API_KEY_SECRET, legacyKey);
    }

    const inspected = config.inspect<string>('apiKey');
    if (inspected?.globalValue !== undefined) {
        await config.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
    }
    if (inspected?.workspaceValue !== undefined) {
        await config.update('apiKey', undefined, vscode.ConfigurationTarget.Workspace);
    }
    if (inspected?.workspaceFolderValue !== undefined) {
        await config.update('apiKey', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    }
}

export async function getModelConfig(): Promise<ModelConfig> {
    const config = vscode.workspace.getConfiguration('soul-bleach');
    const provider = config.get<ModelProvider>('provider', 'qwen');
    const modelPreset = config.get<ModelPreset>('modelPreset', 'provider-default');
    const providerPreset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.qwen;
    const selectedPreset = modelPreset === 'provider-default' ? providerPreset : MODEL_PRESETS[modelPreset] ?? providerPreset;
    return {
        provider,
        modelPreset,
        baseUrl: config.get<string>('baseUrl', '') || selectedPreset.baseUrl,
        apiKey: await secretStorage?.get(API_KEY_SECRET) ?? '',
        model: config.get<string>('model', '') || selectedPreset.model,
        extraBody: selectedPreset.extraBody ?? {}
    };
}

export async function setApiKey(value: string) {
    if (!secretStorage) {
        throw new Error('SecretStorage 尚未初始化。');
    }
    await secretStorage.store(API_KEY_SECRET, value.trim());
}

export async function clearApiKey() {
    await secretStorage?.delete(API_KEY_SECRET);
}
