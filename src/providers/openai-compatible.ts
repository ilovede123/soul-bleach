/**
 * author:dengwei date:2026-07-18
 * OpenAI-compatible HTTP 传输适配器，统一处理连接超时、瞬时错误重试和取消信号。
 */
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class OpenAICompatibleAdapter {
    async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
        let lastError: unknown;

        for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            const abortHandler = () => controller.abort();
            signal?.addEventListener('abort', abortHandler, { once: true });

            try {
                const response = await fetch(url, { ...init, signal: controller.signal });
                if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_REQUEST_ATTEMPTS) {
                    return response;
                }
                await response.body?.cancel();
                await waitBeforeRetry(attempt, signal);
            } catch (error: any) {
                if (signal?.aborted) {
                    throw createAbortError();
                }
                lastError = error;
                if (attempt === MAX_REQUEST_ATTEMPTS) {
                    break;
                }
                await waitBeforeRetry(attempt, signal);
            } finally {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', abortHandler);
            }
        }

        throw new Error(`模型服务连接失败，已重试 ${MAX_REQUEST_ATTEMPTS} 次：${(lastError as any)?.message ?? String(lastError)}`);
    }
}

async function waitBeforeRetry(attempt: number, signal?: AbortSignal) {
    await new Promise<void>((resolve, reject) => {
        const finish = () => {
            signal?.removeEventListener('abort', abortHandler);
            resolve();
        };
        const timer = setTimeout(finish, 500 * 2 ** (attempt - 1));
        const abortHandler = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abortHandler);
            reject(createAbortError());
        };
        signal?.addEventListener('abort', abortHandler, { once: true });
    });
}

function createAbortError(): Error {
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    return error;
}
