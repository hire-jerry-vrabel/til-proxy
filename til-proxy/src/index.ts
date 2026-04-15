export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    try {
      if (path === '/cta/arrivals') {
        const mapid = url.searchParams.get('mapid')
        if (!mapid) return errorResponse(400, 'Missing mapid')
        const res = await fetch(
          `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${env.CTA_API_KEY}&mapid=${mapid}&outputType=JSON`
        )
        const data = await res.text()
        return jsonResponse(data)
      }

      if (path === '/cta/positions') {
        const rt = url.searchParams.get('rt') || 'red'
        const res = await fetch(
          `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${env.CTA_API_KEY}&rt=${rt}&outputType=JSON`
        )
        const data = await res.text()
        return jsonResponse(data)
      }

      if (path === '/ai/insight' && request.method === 'POST') {
        const body = await request.json() as Record<string, unknown>
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        })
        const data = await res.text()
        return jsonResponse(data)
      }

      return errorResponse(404, 'Not found')
    } catch (e) {
      return errorResponse(500, 'Proxy error')
    }
  },
}

interface Env {
  CTA_API_KEY: string
  ANTHROPIC_API_KEY: string
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': 'https://hire-jerry-vrabel.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(data: string): Response {
  return new Response(data, {
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}
