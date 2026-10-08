// Protocol translation only. World rules and actor scheduling do not depend on the provider.
export function requestBody(config, messages, tools, responseItems) {
  const world=tools.some(t=>t.function.name==='settle_round');
  if (config.wireApi !== 'responses') return { model: config.model, messages, tools, tool_choice: 'required', max_tokens: world?6000:1200 };
  return {
    model: config.model,
    instructions: messages[0].content,
    input: responseItems,
    tools: tools.map(({ function: fn }) => ({ type: 'function', ...fn, strict: false })),
    tool_choice: 'required',
    parallel_tool_calls: false,
    store: false,
    stream: true,
    reasoning: { effort: 'low' },
    include: ['reasoning.encrypted_content'],
    max_output_tokens: world?9000:2400
  };
}

export async function readResponse(response) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed;
  const consume = frame => {
    const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'error' || event.type === 'response.failed') throw new Error(`Responses stream failed: ${event.error?.code || event.code || 'provider_error'}`);
    if (event.type === 'response.completed' || event.type === 'response.incomplete') completed = event.response;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
  } finally { reader.releaseLock(); }
  if (!completed) throw new Error('Responses stream ended without final response');
  return completed;
}

export function normalizeResponse(config, payload) {
  if (config.wireApi !== 'responses') return { message: payload.choices?.[0]?.message, items: [] };
  if (payload.status !== 'completed') throw new Error(`Responses 未完整完成：${payload.status || 'unknown'} / ${payload.incomplete_details?.reason || payload.error?.code || 'unknown'}`);
  const items = payload.output || [];
  return {
    // Reasoning items stay in the ephemeral conversation for protocol continuity, never in recordings.
    items,
    message: { role: 'assistant', content: null, tool_calls: items.filter(item => item.type === 'function_call').map(item => ({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } })) }
  };
}
