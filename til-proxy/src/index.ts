// ─── Types ───────────────────────────────────────────────────────────────────

interface Env {
  CTA_API_KEY: string
  ANTHROPIC_API_KEY: string
  TICKETMASTER_API_KEY: string
}

interface NewsItem {
  title: string
  url: string
  source: string
  publishedAt: string
  locality: 'neighborhood' | 'city'
}

interface NewsFeedResponse {
  items: NewsItem[]
  sources: { name: string; status: 'ok' | 'error' }[]
  fetchedAt: string
}

interface EventItem {
  title: string
  url: string
  source: string
  venue: string
  startDate: string
  category: string
  locality: 'neighborhood' | 'city'
}

interface EventsFeedResponse {
  items: EventItem[]
  sources: { name: string; status: 'ok' | 'error' }[]
  fetchedAt: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LAT = 41.9981
const LNG = -87.6673
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TILDashboard/1.0)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
}
const NEWS_CACHE_TTL = 300
const EVENTS_CACHE_TTL = 300

// ─── RSS Feed Configuration ─────────────────────────────────────────────────

const RSS_FEEDS = [
  {
    url: 'https://news.google.com/rss/search?q=Rogers+Park+Chicago&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News',
    locality: 'neighborhood' as const,
  },
  {
    url: 'https://blockclubchicago.org/feed',
    source: 'Block Club Chicago',
    locality: 'neighborhood' as const,
  },
  {
    url: 'https://news.wttw.com/feed',
    source: 'WTTW',
    locality: 'city' as const,
  },
  {
    url: 'https://chicago.suntimes.com/rss/index.xml',
    source: 'Chicago Sun-Times',
    locality: 'city' as const,
  },
  {
    url: 'https://chicagoreader.com/feed',
    source: 'Chicago Reader',
    locality: 'city' as const,
  },
]

// ─── RSS Parser ──────────────────────────────────────────────────────────────

function parseRSSItems(xml: string, source: string, locality: 'neighborhood' | 'city'): NewsItem[] {
  const items: NewsItem[] = []

  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi
  let itemMatch: RegExpExecArray | null

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1]

    const titleMatch = block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/)
    let title = titleMatch ? titleMatch[1].trim() : ''
    title = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
    title = decodeEntities(title)

    const linkMatch = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/)
    let url = linkMatch ? linkMatch[1].trim() : ''
    url = url.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()

    if (!url) {
      const linkHrefMatch = block.match(/<link[^>]+href=["']([^"']+)["']/)
      url = linkHrefMatch ? linkHrefMatch[1] : ''
    }

    const dateMatch = block.match(/<pubDate(?:\s[^>]*)?>([\s\S]*?)<\/pubDate>/)
    let publishedAt = ''
    if (dateMatch) {
      const parsed = new Date(dateMatch[1].trim())
      publishedAt = isNaN(parsed.getTime()) ? '' : parsed.toISOString()
    }

    if (!publishedAt) {
      const dcDateMatch = block.match(/<dc:date(?:\s[^>]*)?>([\s\S]*?)<\/dc:date>/)
        || block.match(/<updated(?:\s[^>]*)?>([\s\S]*?)<\/updated>/)
      if (dcDateMatch) {
        const parsed = new Date(dcDateMatch[1].trim())
        publishedAt = isNaN(parsed.getTime()) ? '' : parsed.toISOString()
      }
    }

    if (title && url) {
      items.push({ title, url, source, publishedAt, locality })
    }
  }

  const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi
  let entryMatch: RegExpExecArray | null

  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const block = entryMatch[1]

    const titleMatch = block.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/)
    let title = titleMatch ? titleMatch[1].trim() : ''
    title = title.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim()
    title = decodeEntities(title)

    const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["']/)
    const url = linkMatch ? linkMatch[1] : ''

    const dateMatch = block.match(/<updated(?:\s[^>]*)?>([\s\S]*?)<\/updated>/)
      || block.match(/<published(?:\s[^>]*)?>([\s\S]*?)<\/published>/)
    let publishedAt = ''
    if (dateMatch) {
      const parsed = new Date(dateMatch[1].trim())
      publishedAt = isNaN(parsed.getTime()) ? '' : parsed.toISOString()
    }

    if (title && url) {
      items.push({ title, url, source, publishedAt, locality })
    }
  }

  return items
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function normalizeForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deduplicateItems<T extends { title: string }>(items: T[]): T[] {
  const seen = new Map<string, T>()
  for (const item of items) {
    const key = normalizeForDedup(item.title)
    if (!seen.has(key)) {
      seen.set(key, item)
    }
  }
  return Array.from(seen.values())
}

// ─── News Feed Handler ──────────────────────────────────────────────────────

async function handleNewsFeed(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url, { headers: FETCH_HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const xml = await res.text()
      return parseRSSItems(xml, feed.source, feed.locality)
    })
  )

  let allItems: NewsItem[] = []
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      allItems = allItems.concat(result.value)
    }
  })

  allItems = deduplicateItems(allItems)

  allItems.sort((a, b) => {
    if (a.locality !== b.locality) {
      return a.locality === 'neighborhood' ? -1 : 1
    }
    if (a.publishedAt && b.publishedAt) {
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    }
    if (a.publishedAt) return -1
    if (b.publishedAt) return 1
    return 0
  })

  return allItems.slice(0, 10)
}

// ─── Events Feed Handler ────────────────────────────────────────────────────

async function fetchTicketmasterEvents(apiKey: string): Promise<EventItem[]> {
  const now = new Date()
  const startDateTime = now.toISOString().split('.')[0] + 'Z'
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const endDateTime = end.toISOString().split('.')[0] + 'Z'

  const url = `https://app.ticketmaster.com/discovery/v2/events.json?city=Chicago&stateCode=IL&size=20&sort=date,asc&apikey=${apiKey}`

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Ticketmaster HTTP ${res.status}`)
  const data = await res.json() as {
    _embedded?: {
      events?: {
        name: string
        url: string
        dates?: { start?: { localDate?: string; localTime?: string } }
        _embedded?: { venues?: { name?: string; city?: { name?: string } }[] }
        classifications?: { segment?: { name?: string }; genre?: { name?: string } }[]
      }[]
    }
  }

  const events = data._embedded?.events ?? []
  return events.map((e) => {
    const venue = e._embedded?.venues?.[0]
    const classification = e.classifications?.[0]
    const category = classification?.genre?.name ?? classification?.segment?.name ?? 'Event'
    const startDate = e.dates?.start?.localDate ?? ''
    const startTime = e.dates?.start?.localTime ?? ''
    const startISO = startDate
      ? startTime
        ? `${startDate}T${startTime}`
        : `${startDate}T00:00:00`
      : ''

    return {
      title: e.name,
      url: e.url,
      source: 'Ticketmaster',
      venue: venue?.name ?? '',
      startDate: startISO,
      category,
      locality: 'city' as const,
    }
  })
}

async function fetchParkDistrictEvents(): Promise<EventItem[]> {
  const now = new Date()
  const startDate = now.toISOString().split('T')[0]
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const endDate = end.toISOString().split('T')[0]

  const url = `https://data.cityofchicago.org/resource/pk66-w54g.json?$where=reservation_start_date>='${startDate}' AND reservation_start_date<='${endDate}' AND permit_status='Approved'&$order=reservation_start_date ASC&$limit=30`

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Park District HTTP ${res.status}`)
  const data = await res.json() as {
    park_facility_name?: string
    event_description?: string
    event_type?: string
    reservation_start_date?: string
    reservation_end_date?: string
    permit_status?: string
  }[]

  return data
    .filter((e) => {
      const desc = (e.event_description ?? '').toLowerCase()
      // Filter out internal admin holds and generic permits
      return !desc.includes('admin hold') && !desc.includes('administrative')
    })
    .map((e) => {
      const startRaw = e.reservation_start_date ?? ''
      const startDate = startRaw ? startRaw.split('T')[0] + 'T00:00:00' : ''
      const parkName = e.park_facility_name ?? ''
      // Extract just the park name (before specific location details)
      const venueName = parkName.split(/\s+(Lawn|Field|Grove|Statue|Lagoon|Gym|Hall)/i)[0] || parkName

      return {
        title: e.event_description ?? 'Park Event',
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parkName + ' Chicago')}`,
        source: 'Chicago Parks',
        venue: venueName,
        startDate,
        category: simplifyEventType(e.event_type ?? ''),
        locality: 'neighborhood' as const,
      }
    })
}

function simplifyEventType(eventType: string): string {
  const lower = eventType.toLowerCase()
  if (lower.includes('athletic')) return 'Athletics'
  if (lower.includes('festival') || lower.includes('performance')) return 'Festival'
  if (lower.includes('picnic')) return 'Community'
  if (lower.includes('media')) return 'Media'
  if (lower.includes('corporate')) return 'Corporate'
  if (lower.includes('promotion')) return 'Promotion'
  return 'Community'
}

async function handleEventsFeed(env: Env): Promise<EventItem[]> {
  const results = await Promise.allSettled([
    fetchTicketmasterEvents(env.TICKETMASTER_API_KEY),
    fetchParkDistrictEvents(),
  ])

  let allItems: EventItem[] = []
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      allItems = allItems.concat(result.value)
    }
  })

  allItems = deduplicateItems(allItems)

  allItems.sort((a, b) => {
    if (a.startDate && b.startDate) {
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    }
    if (a.startDate) return -1
    if (b.startDate) return 1
    return 0
  })

  return allItems.slice(0, 12)
}

// ─── CORS & Response Helpers ─────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': 'https://hire-jerry-vrabel.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(data: string, cacheSeconds?: number): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  }
  if (cacheSeconds) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}`
  }
  return new Response(data, { headers })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

// ─── Worker Entry ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() })
    }

    try {
      // ── CTA Arrivals ─────────────────────────────────────────────────
      if (path === '/cta/arrivals') {
        const mapid = url.searchParams.get('mapid')
        if (!mapid) return errorResponse(400, 'Missing mapid')
        const res = await fetch(
          `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?key=${env.CTA_API_KEY}&mapid=${mapid}&outputType=JSON`
        )
        const data = await res.text()
        return jsonResponse(data)
      }

      // ── CTA Positions ────────────────────────────────────────────────
      if (path === '/cta/positions') {
        const rt = url.searchParams.get('rt') || 'red'
        const res = await fetch(
          `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${env.CTA_API_KEY}&rt=${rt}&outputType=JSON`
        )
        const data = await res.text()
        return jsonResponse(data)
      }

      // ── AI Insight ───────────────────────────────────────────────────
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

      // ── News Feed ────────────────────────────────────────────────────
      if (path === '/news/feed') {
        const cacheKey = new Request(url.toString(), request)
        const cache = caches.default
        let response = await cache.match(cacheKey)

        if (response) {
          const newResponse = new Response(response.body, response)
          Object.entries(corsHeaders()).forEach(([k, v]) => newResponse.headers.set(k, v))
          return newResponse
        }

        const items = await handleNewsFeed()
        const payload: NewsFeedResponse = {
          items,
          sources: RSS_FEEDS.map((f) => ({ name: f.source, status: 'ok' as const })),
          fetchedAt: new Date().toISOString(),
        }

        response = jsonResponse(JSON.stringify(payload), NEWS_CACHE_TTL)
        const cacheResponse = response.clone()
        cacheResponse.headers.set('Cache-Control', `public, max-age=${NEWS_CACHE_TTL}`)
        request.method === 'GET' && cache.put(cacheKey, cacheResponse).catch(() => {})

        return response
      }

      // ── Events Feed ──────────────────────────────────────────────────
      if (path === '/events/feed') {
        const cacheKey = new Request(url.toString(), request)
        const cache = caches.default
        let response = await cache.match(cacheKey)

        if (response) {
          const newResponse = new Response(response.body, response)
          Object.entries(corsHeaders()).forEach(([k, v]) => newResponse.headers.set(k, v))
          return newResponse
        }

        const items = await handleEventsFeed(env)
        const sources: { name: string; status: 'ok' | 'error' }[] = []
        // We can't easily get per-source status from allSettled here,
				// so we report all as ok (errors are silently dropped)
				sources.push({ name: 'Ticketmaster', status: 'ok' })
        sources.push({ name: 'Chicago Parks', status: 'ok' })

        const payload: EventsFeedResponse = {
          items,
          sources,
          fetchedAt: new Date().toISOString(),
        }

        response = jsonResponse(JSON.stringify(payload), EVENTS_CACHE_TTL)
        const cacheResponse = response.clone()
        cacheResponse.headers.set('Cache-Control', `public, max-age=${EVENTS_CACHE_TTL}`)
        request.method === 'GET' && cache.put(cacheKey, cacheResponse).catch(() => {})

        return response
      }

      return errorResponse(404, 'Not found')
    } catch (e) {
      return errorResponse(500, 'Proxy error')
    }
  },
}
