/**
 * author:dengwei date:2026-07-18
 * 上下文补丁引擎。所有编辑先在内存中校验和应用，全部成功后再由调用方写入文件。
 */
export type TextPatchEdit = {
    oldText: string;
    newText: string;
    occurrence?: number;
};

export type TextPatchResult = {
    content: string;
    applied: number;
};

export function applyTextEdits(source: string, edits: TextPatchEdit[]): TextPatchResult {
    if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error('apply_patch 至少需要一个 edit。');
    }
    if (edits.length > 30) {
        throw new Error('单次 apply_patch 最多允许 30 个 edit，请拆分后重试。');
    }

    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    let working = source.replace(/\r\n/g, '\n');

    for (let index = 0; index < edits.length; index++) {
        const oldText = String(edits[index]?.oldText ?? '').replace(/\r\n/g, '\n');
        const newText = String(edits[index]?.newText ?? '').replace(/\r\n/g, '\n');
        const occurrence = edits[index]?.occurrence;

        if (!oldText) {
            throw new Error(`第 ${index + 1} 个 edit 的 oldText 不能为空。`);
        }

        const positions = findOccurrences(working, oldText);
        if (positions.length === 0) {
            throw new Error(`第 ${index + 1} 个 edit 未找到 oldText，文件可能已经变化，请重新读取。`);
        }

        let position: number;
        if (occurrence === undefined) {
            if (positions.length > 1) {
                throw new Error(`第 ${index + 1} 个 edit 的 oldText 出现 ${positions.length} 次，请扩大上下文或传 occurrence。`);
            }
            position = positions[0];
        } else {
            if (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > positions.length) {
                throw new Error(`第 ${index + 1} 个 edit 的 occurrence 无效，有效范围是 1-${positions.length}。`);
            }
            position = positions[occurrence - 1];
        }

        working = `${working.slice(0, position)}${newText}${working.slice(position + oldText.length)}`;
    }

    return {
        content: eol === '\n' ? working : working.replace(/\n/g, '\r\n'),
        applied: edits.length
    };
}

function findOccurrences(content: string, search: string): number[] {
    const positions: number[] = [];
    let offset = 0;
    while (offset <= content.length - search.length) {
        const position = content.indexOf(search, offset);
        if (position < 0) {
            break;
        }
        positions.push(position);
        offset = position + Math.max(1, search.length);
    }
    return positions;
}
