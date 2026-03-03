import OpenAI from "openai";
let openai_test = new OpenAI({})
type ResponseParams = Parameters<typeof openai_test.responses.create>[0];
let example: ResponseParams = {
	input: [
		{
			role: "user", 
			content: [
				{type: 'input_text', text: "hello world"},
				{type: 'input_image', file_id: "some file id", detail: 'auto'},
			]
		}
	]
}