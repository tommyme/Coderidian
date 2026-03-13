/**
 * HTTP 请求拦截器模块
 *
 * 提供以下功能：
 * - 请求拦截器：在请求发送前修改请求参数
 * - 响应拦截器：在响应返回前处理响应
 * - 错误拦截器：统一处理请求错误
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

// ==================== 类型定义 ====================

/** 请求拦截器函数类型 */
export type RequestInterceptor = (
	config: RequestUrlParam
) => RequestUrlParam | Promise<RequestUrlParam>;

/** 响应拦截器函数类型 */
export type ResponseInterceptor = (
	response: RequestUrlResponse,
	config: RequestUrlParam
) => RequestUrlResponse | Promise<RequestUrlResponse>;

/** 错误拦截器函数类型 */
export type ErrorInterceptor = (
	error: Error,
	config: RequestUrlParam
) => Error | Promise<Error>;

/** 拦截器条目（带名字） */
interface InterceptorEntry<T> {
	interceptor: T;
	name: string;
}

/** 拦截器管理器 */
export class HttpInterceptor {
	private static instance: HttpInterceptor;

	/** 请求拦截器列表 */
	private requestInterceptors: InterceptorEntry<RequestInterceptor>[] = [];
	/** 响应拦截器列表 */
	private responseInterceptors: InterceptorEntry<ResponseInterceptor>[] = [];
	/** 错误拦截器列表 */
	private errorInterceptors: InterceptorEntry<ErrorInterceptor>[] = [];

	/** 是否已初始化 */
	private initialized = false;

	/** 当前请求的开始时间（用于计算耗时） */
	private startTimeGetter: (() => number) | null = null;

	private constructor() {}

	/**
	 * 获取单例实例
	 */
	static getInstance(): HttpInterceptor {
		if (!HttpInterceptor.instance) {
			HttpInterceptor.instance = new HttpInterceptor();
		}
		return HttpInterceptor.instance;
	}

	/**
	 * 初始化拦截器
	 * 替换全局 requestUrl
	 */
	initialize(): void {
		if (this.initialized) {
			console.warn('[HttpInterceptor] Already initialized');
			return;
		}

		// 保存原始 requestUrl
		const originalRequestUrl = requestUrl;

		// 替换全局 requestUrl
		(globalThis as any).requestUrl = async (params: RequestUrlParam) => {
			return this.handleRequest(params, originalRequestUrl);
		};

		this.initialized = true;
		console.log('[HttpInterceptor] Initialized');
	}

	/**
	 * 获取当前请求的开始时间
	 */
	getStartTime(): number | null {
		return this.startTimeGetter ? this.startTimeGetter() : null;
	}

	/**
	 * 处理请求
	 */
	private async handleRequest(
		params: RequestUrlParam,
		originalRequestUrl: (params: RequestUrlParam) => Promise<RequestUrlResponse>
	): Promise<RequestUrlResponse> {
		const startTime = Date.now();
		this.startTimeGetter = () => startTime;

		try {
			// 1. 应用请求拦截器
			let modifiedParams = params;
			
			// 强制关闭 HTTP 错误自动抛出异常的行为
			modifiedParams.throw = false;

			for (const entry of this.requestInterceptors) {
				console.group(`📤 Request Interceptor - ${entry.name}`);
				modifiedParams = await entry.interceptor(modifiedParams);
				console.groupEnd();
			}

			// 2. 发送请求
			const response = await originalRequestUrl(modifiedParams);

			// 3. 应用响应拦截器
			let modifiedResponse = response;
			for (const entry of this.responseInterceptors) {
				console.group(`📥 Response Interceptor - ${entry.name}`);
				modifiedResponse = await entry.interceptor(modifiedResponse, modifiedParams);
				console.groupEnd();
			}

			return modifiedResponse;
		} catch (error) {
			// 4. 应用错误拦截器
			let finalError = error instanceof Error ? error : new Error(String(error));

			for (const entry of this.errorInterceptors) {
				console.group(`❌ Error Interceptor - ${entry.name}`);
				finalError = await entry.interceptor(finalError, params) as Error;
				console.groupEnd();
			}

			console.error(`❌ ${params.method} ${params.url} - ${finalError.message} (${Date.now() - startTime}ms)`);

			throw finalError;
		}
	}

	// ==================== 拦截器管理 ====================

	/**
	 * 通用方法：添加拦截器
	 */
	private addInterceptor<T>(
		list: InterceptorEntry<T>[],
		interceptor: T,
		name: string
	): () => void {
		const existingIndex = list.findIndex(e => e.name === name);
		if (existingIndex > -1) list.splice(existingIndex, 1);

		list.push({ interceptor, name });
		return () => {
			const idx = list.findIndex(e => e.name === name);
			if (idx > -1) list.splice(idx, 1);
		};
	}

	addRequestInterceptor(interceptor: RequestInterceptor, name: string): () => void {
		return this.addInterceptor(this.requestInterceptors, interceptor, name);
	}

	addResponseInterceptor(interceptor: ResponseInterceptor, name: string): () => void {
		return this.addInterceptor(this.responseInterceptors, interceptor, name);
	}

	addErrorInterceptor(interceptor: ErrorInterceptor, name: string): () => void {
		return this.addInterceptor(this.errorInterceptors, interceptor, name);
	}

	/**
	 * 清除所有拦截器
	 */
	clearInterceptors(): void {
		this.requestInterceptors = [];
		this.responseInterceptors = [];
		this.errorInterceptors = [];
	}
}

// ==================== 默认拦截器 ====================

/**
 * 默认请求日志拦截器 - 打印完整请求信息
 */
export function createDefaultRequestInterceptor(): RequestInterceptor {
	return (config) => {
		// 解析 URL 提取 query 参数
		const urlObj = new URL(config.url);
		const queryParams: Record<string, string> = {};
		urlObj.searchParams.forEach((value, key) => {
			queryParams[key] = value;
		});

		// 解析 body
		let bodyData: any = null;
		if (config.body) {
			try {
				if (typeof config.body === 'string') {
					bodyData = JSON.parse(config.body);
				} else if (config.body instanceof FormData) {
					bodyData = 'FormData';
				} else {
					bodyData = config.body;
				}
			} catch {
				bodyData = config.body;
			}
		}

		console.log('🔗 URL:', config.url);
		console.log('📝 Method:', config.method);
		console.log('📋 Query Params:', queryParams);
		console.log('📦 Body:', bodyData);
		console.log('📨 Headers:', config.headers);

		// 生成等价的 curl 命令
		const curlCommand = generateCurlCommand(config);
		console.log('🐚 Curl:\n', curlCommand);

		return config;
	};
}

/**
 * 基于请求配置生成等价的 curl 命令
 */
function generateCurlCommand(config: RequestUrlParam): string {
	const parts: string[] = ['curl', '-i'];

	// URL 放最前面
	parts.push(`'${config.url}'`);

	// 方法
	if (config.method && config.method !== 'GET') {
		parts.push(`-X ${config.method}`);
	}

	// Headers
	if (config.headers) {
		for (const [key, value] of Object.entries(config.headers)) {
			if (value !== undefined) {
				parts.push(`-H '${key}: ${value}'`);
			}
		}
	}

	// Body
	if (config.body) {
		if (typeof config.body === 'string') {
			// 尝试解析 JSON
			try {
				const json = JSON.parse(config.body);
				parts.push(`--data-raw '${JSON.stringify(json).replace(/'/g, "\\'")}'`);
			} catch {
				// 如果不是 JSON，直接使用
				const escaped = config.body.replace(/'/g, "\\'");
				parts.push(`--data-raw '${escaped}'`);
			}
		} else {
			parts.push(`--data-raw '[${typeof config.body}]'`);
		}
	}

	return parts.join(' \\\n  ');
}

/**
 * 默认响应日志拦截器 - 打印完整响应信息
 */
export function createDefaultResponseInterceptor(): ResponseInterceptor {
	return (response, config) => {
		const instance = HttpInterceptor.getInstance();
		const getStartTime = () => instance.getStartTime();
		const duration = getStartTime ? Date.now() - getStartTime()! : null;

		// 尝试解析响应体
		let responseData: any = null;
		try {
			if (response.arrayBuffer) {
				const text = new TextDecoder().decode(response.arrayBuffer);
				if (text) {
					try {
						responseData = JSON.parse(text);
					} catch {
						responseData = text.substring(0, 500);
					}
				}
			}
		} catch {
			responseData = '[Unable to decode]';
		}

		console.log('📊 Status:', response.status);
		if (duration !== null) {
			console.log('⏱️ Duration:', `${duration}ms`);
		}
		console.log('📨 Headers:', response.headers);
		console.log('📦 Data:', responseData);

		return response;
	};
}

/**
 * 默认错误拦截器 - 打印完整错误信息
 */
export function createDefaultErrorInterceptor(): ErrorInterceptor {
	return (error, config) => {
		const instance = HttpInterceptor.getInstance();
		const getStartTime = () => instance.getStartTime();
		const duration = getStartTime ? Date.now() - getStartTime()! : null;

		console.log('📝 Error Message:', error.message);
		if (duration !== null) {
			console.log('⏱️ Duration:', `${duration}ms`);
		}
		console.log('🔗 URL:', config.url);
		console.log('📨 Headers:', config.headers);

		return error;
	};
}

// ==================== 便捷函数 ====================

/**
 * 创建默认配置的拦截器并初始化
 */
export function createHttpInterceptor(): HttpInterceptor {
	const interceptor = HttpInterceptor.getInstance();
	interceptor.initialize();

	// 添加默认拦截器
	interceptor.addRequestInterceptor(createDefaultRequestInterceptor(), 'default-request');
	interceptor.addResponseInterceptor(createDefaultResponseInterceptor(), 'default-response');
	interceptor.addErrorInterceptor(createDefaultErrorInterceptor(), 'default-error');

	return interceptor;
}
