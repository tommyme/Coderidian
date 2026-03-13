/**
 * HTTP 请求拦截器模块（简化版）
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

/** 拦截器配置（保留接口，未来可能扩展） */
export interface InterceptorConfig {
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

	/** 请求日志 */
	private requestLogs: RequestLog[] = [];

	/** 是否已初始化 */
	private initialized = false;

	/** 当前请求的开始时间（用于计算耗时） */
	currentStartTimeGetter: (() => number) | null = null;

	/**
	 * 获取当前请求的开始时间
	 */
	getStartTime(): number | null {
		return this.currentStartTimeGetter ? this.currentStartTimeGetter() : null;
	}

	private constructor(config: InterceptorConfig = {}) {
	}

	/**
	 * 获取单例实例
	 */
	static getInstance(config?: InterceptorConfig): HttpInterceptor {
		if (!HttpInterceptor.instance) {
			HttpInterceptor.instance = new HttpInterceptor(config);
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
	 * 处理请求
	 */
	private async handleRequest(
		params: RequestUrlParam,
		originalRequestUrl: (params: RequestUrlParam) => Promise<RequestUrlResponse>
	): Promise<RequestUrlResponse> {
		const requestId = this.generateRequestId();
		const startTime = Date.now();
		this.currentStartTimeGetter = () => startTime;

		try {
			// 1. 应用请求拦截器
			let modifiedParams = params;
			if (this.requestInterceptors.length > 0) {
				console.group(`HttpInterceptor Request Interceptor - ${this.requestInterceptors.map(e => e.name).join(', ')}`);
			}
			for (const entry of this.requestInterceptors) {
				modifiedParams = await entry.interceptor(modifiedParams);
			}
			if (this.requestInterceptors.length > 0) {
				console.groupEnd();
			}

			// 2. 发送请求
			const response = await originalRequestUrl(modifiedParams);

			// 3. 应用响应拦截器
			if (this.responseInterceptors.length > 0) {
				console.group(`HttpInterceptor Response Interceptor - ${this.responseInterceptors.map(e => e.name).join(', ')}`);
			}
			let modifiedResponse = response;
			for (const entry of this.responseInterceptors) {
				modifiedResponse = await entry.interceptor(modifiedResponse, modifiedParams);
			}
			if (this.responseInterceptors.length > 0) {
				console.groupEnd();
			}

			// 4. 记录日志
			this.log({
				requestId,
				url: modifiedParams.url,
				method: modifiedParams.method,
				status: modifiedResponse.status,
				statusText: modifiedResponse.status.toString(),
				duration: Date.now() - startTime,
				config: modifiedParams,
				response: modifiedResponse
			});

			return modifiedResponse;
		} catch (error) {
			// 5. 应用错误拦截器
			let finalError = error instanceof Error ? error : new Error(String(error));

			if (this.errorInterceptors.length > 0) {
				console.group(`HttpInterceptor Error Interceptor - ${this.errorInterceptors.map(e => e.name).join(', ')}`);
			}
			for (const entry of this.errorInterceptors) {
				finalError = await entry.interceptor(finalError, params) as Error;
			}
			if (this.errorInterceptors.length > 0) {
				console.groupEnd();
			}

			// 记录错误日志
			this.log({
				requestId,
				url: params.url,
				method: params.method,
				status: 'ERROR',
				error: finalError.message,
				config: params
			});

			throw finalError;
		}
	}

	/**
	 * 生成请求 ID
	 */
	private generateRequestId(): string {
		return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	// ==================== 拦截器管理 ====================

	/**
	 * 添加请求拦截器
	 * @param interceptor 拦截器函数
	 * @param name 拦截器名称（唯一标识）
	 */
	addRequestInterceptor(interceptor: RequestInterceptor, name: string): () => void {
		// 检查是否已存在同名拦截器
		const existingIndex = this.requestInterceptors.findIndex(e => e.name === name);
		if (existingIndex > -1) {
			console.warn(`[HttpInterceptor] Request interceptor "${name}" already exists, replacing`);
			this.requestInterceptors.splice(existingIndex, 1);
		}

		this.requestInterceptors.push({ interceptor, name });
		return () => {
			const index = this.requestInterceptors.findIndex(e => e.name === name);
			if (index > -1) {
				this.requestInterceptors.splice(index, 1);
			}
		};
	}

	/**
	 * 添加响应拦截器
	 * @param interceptor 拦截器函数
	 * @param name 拦截器名称（唯一标识）
	 */
	addResponseInterceptor(interceptor: ResponseInterceptor, name: string): () => void {
		// 检查是否已存在同名拦截器
		const existingIndex = this.responseInterceptors.findIndex(e => e.name === name);
		if (existingIndex > -1) {
			console.warn(`[HttpInterceptor] Response interceptor "${name}" already exists, replacing`);
			this.responseInterceptors.splice(existingIndex, 1);
		}

		this.responseInterceptors.push({ interceptor, name });
		return () => {
			const index = this.responseInterceptors.findIndex(e => e.name === name);
			if (index > -1) {
				this.responseInterceptors.splice(index, 1);
			}
		};
	}

	/**
	 * 添加错误拦截器
	 * @param interceptor 拦截器函数
	 * @param name 拦截器名称（唯一标识）
	 */
	addErrorInterceptor(interceptor: ErrorInterceptor, name: string): () => void {
		// 检查是否已存在同名拦截器
		const existingIndex = this.errorInterceptors.findIndex(e => e.name === name);
		if (existingIndex > -1) {
			console.warn(`[HttpInterceptor] Error interceptor "${name}" already exists, replacing`);
			this.errorInterceptors.splice(existingIndex, 1);
		}

		this.errorInterceptors.push({ interceptor, name });
		return () => {
			const index = this.errorInterceptors.findIndex(e => e.name === name);
			if (index > -1) {
				this.errorInterceptors.splice(index, 1);
			}
		};
	}

	/**
	 * 清除所有拦截器
	 */
	clearInterceptors(): void {
		this.requestInterceptors = [];
		this.responseInterceptors = [];
		this.errorInterceptors = [];
	}

	// ==================== 日志管理 ====================

	/**
	 * 记录日志
	 */
	private log(log: RequestLog): void {
		this.requestLogs.push(log);

		// 保留最近 1000 条日志
		if (this.requestLogs.length > 1000) {
			this.requestLogs = this.requestLogs.slice(-1000);
		}
	}

	/**
	 * 获取请求日志
	 */
	getLogs(): RequestLog[] {
		return [...this.requestLogs];
	}

	/**
	 * 清除日志
	 */
	clearLogs(): void {
		this.requestLogs = [];
	}

	// ==================== 便捷方法 ====================

	/**
	 * 创建带有认证的请求拦截器
	 */
	static createAuthInterceptor(apiKey: string, headerName: string = 'Authorization'): RequestInterceptor {
		return (config) => {
			return {
				...config,
				headers: {
					...config.headers,
					[headerName]: `Bearer ${apiKey}`
				}
			};
		};
	}

	/**
	 * 创建请求参数日志拦截器
	 * 在请求发出去之前打印所有参数
	 */
	static createRequestLoggerInterceptor(): RequestInterceptor {
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

			// 打印日志
			console.log(`📤 Request: ${config.method} ${config.url}`);
			console.log('🔗 URL:', config.url);
			console.log('📝 Method:', config.method);
			console.log('📋 Query Params:', queryParams);
			console.log('📦 Body:', bodyData);
			console.log('📨 Headers:', config.headers);

			return config;
		};
	}

	/**
	 * 创建响应日志拦截器
	 * 在响应返回后打印所有响应参数
	 */
	static createResponseLoggerInterceptor(getStartTime?: () => number): ResponseInterceptor {
		// 如果没有传入getStartTime，则从实例获取
		const getStartTimeFn = getStartTime || (() => {
			const instance = HttpInterceptor.getInstance();
			return instance.getStartTime();
		});

		return (response, config) => {
			// 尝试解析响应体
			let responseData: any = null;
			try {
				if (response.arrayBuffer) {
					const text = new TextDecoder().decode(response.arrayBuffer);
					if (text) {
						try {
							responseData = JSON.parse(text);
						} catch {
							responseData = text.substring(0, 500); // 截取前500字符
						}
					}
				}
			} catch {
				responseData = '[Unable to decode]';
			}

			// 计算耗时
			const duration = getStartTimeFn ? Date.now() - getStartTimeFn()! : null;

			// 打印日志
			console.log(`📥 Response: ${config.method} ${config.url}`);
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
	 * 创建 API 错误处理拦截器
	 */
	static createErrorHandlerInterceptor(): ResponseInterceptor {
		return (response, config) => {
			if (response.status >= 400) {
				const error = new Error(`API Error: ${response.status} ${response.statusText}`);
				throw error;
			}
			return response;
		};
	}
}

// ==================== 日志类型 ====================

export interface RequestLog {
	requestId: string;
	url: string;
	method: string;
	status: number | string;
	statusText?: string;
	duration: number;
	attempt?: number;
	error?: string;
	config?: RequestUrlParam;
	response?: RequestUrlResponse;
}

// ==================== 便捷函数 ====================

/**
 * 创建默认配置的拦截器并初始化
 */
export function createHttpInterceptor(config?: InterceptorConfig): HttpInterceptor {
	const interceptor = HttpInterceptor.getInstance(config);
	interceptor.initialize();
	return interceptor;
}
