import { EmbeddingStore, SimilarNote } from './types';

/**
 * 余弦相似度计算
 * 与 jsbrains/smart-utils/cos_sim.js 算法一致
 */
export function cosSim(a: number[], b: number[]): number {
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	const denom = Math.sqrt(magA) * Math.sqrt(magB);
	if (denom < 1e-8) return 0;
	return dot / denom;
}

/**
 * 在 EmbeddingStore 中查找与 queryVecs 最相似的 top-K 笔记
 *
 * 查询侧可以有多个 chunk 向量（当前笔记的所有 chunk）；
 * 候选侧同样有多个 chunk；
 * 每对 (queryChunk, candidateChunk) 计算一次 cosSim，取全局最高分代表该笔记。
 *
 * @param store       向量存储
 * @param queryVecs   当前笔记的所有 chunk 向量
 * @param k           返回数量
 * @param excludePath 排除当前笔记自身
 */
export function findTopK(
	store: EmbeddingStore,
	queryVecs: number[][],
	k: number,
	excludePath: string,
): SimilarNote[] {
	if (queryVecs.length === 0) return [];
	const dims = queryVecs[0].length;

	// path → { score, matchedChunk }
	const best = new Map<string, { score: number; matchedChunk: string }>();

	for (const [path, embedding] of Object.entries(store.notes)) {
		if (path === excludePath) continue;
		if (!embedding.chunks?.length) continue;

		for (const chunk of embedding.chunks) {
			if (!chunk.vec || chunk.vec.length !== dims) continue;
			for (const qVec of queryVecs) {
				const score = cosSim(qVec, chunk.vec);
				const current = best.get(path);
				if (!current || score > current.score) {
					best.set(path, { score, matchedChunk: chunk.preview });
				}
			}
		}
	}

	return Array.from(best.entries())
		.map(([path, { score, matchedChunk }]) => ({ path, score, matchedChunk }))
		.sort((a, b) => b.score - a.score)
		.slice(0, k);
}
