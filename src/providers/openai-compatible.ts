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
                const retryAfter = response.headers.get('retry-after');
                await response.body?.cancel();
                await waitBeforeRetry(attempt, signal, retryAfter);
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

async function waitBeforeRetry(attempt: number, signal?: AbortSignal, retryAfter?: string | null) {
    await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(createAbortError());
            return;
        }
        const finish = () => {
            signal?.removeEventListener('abort', abortHandler);
            resolve();
        };
        const timer = setTimeout(finish, calculateRetryDelayMs(attempt, retryAfter));
        const abortHandler = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abortHandler);
            reject(createAbortError());
        };
        signal?.addEventListener('abort', abortHandler, { once: true });
    });
}

/** 根据指数退避和服务端 Retry-After 计算下一次请求延迟，并加入少量抖动避免并发重试再次撞车。 */
export function calculateRetryDelayMs(attempt: number, retryAfter?: string | null, randomValue = Math.random()): number {
    const exponentialDelay = 500 * 2 ** Math.max(0, attempt - 1);
    const serverDelay = parseRetryAfterMs(retryAfter);
    const jitter = Math.floor(Math.max(0, Math.min(1, randomValue)) * 250);
    return Math.min(60_000, Math.max(exponentialDelay, serverDelay) + jitter);
}

function parseRetryAfterMs(value?: string | null): number {
    if (!value) {
        return 0;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
}

function createAbortError(): Error {
    const error = new Error('Request aborted.');
    error.name = 'AbortError';
    return error;
}
