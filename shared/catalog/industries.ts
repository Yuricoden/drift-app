import type { Industry } from '../types.js';

/** Domains cultural signals move between, used across the map, transfer lab and generators. */
export const INDUSTRIES: Industry[] = [
  {
    id: 'music', name: 'Music',
    description: 'Streaming, live performance, and the scenes that form around sound.',
    customers: ['young listeners building identity through taste', 'independent artists and micro-labels', 'live-music regulars'],
    behaviors: ['playlist-sharing as social currency', 'following scenes rather than genres', 'collecting physical releases as proof of taste'],
    frictions: ['algorithmic sameness across streaming platforms', 'passive listening replacing active discovery', 'the collapse of local scenes into feeds'],
  },
  {
    id: 'fashion', name: 'Fashion',
    description: 'Apparel, luxury houses, and the resale economy.',
    customers: ['style-led Gen Z shoppers', 'archive and resale collectors', 'quiet-luxury professionals'],
    behaviors: ['styling second-hand finds into new looks', 'treating garments as identity documents', 'researching provenance before buying'],
    frictions: ['trend cycles moving faster than wardrobes', 'greenwashing fatigue', 'overproduction and returns culture'],
  },
  {
    id: 'hospitality', name: 'Hospitality',
    description: 'Hotels, restaurants, bars, and third places.',
    customers: ['experience-first urban diners', 'solo travellers seeking local texture', 'regulars who treat venues as living rooms'],
    behaviors: ['booking for atmosphere over cuisine', 'joining supper clubs and listening bars', 'documenting spaces as much as meals'],
    frictions: ['homogenised, Instagram-optimised interiors', 'staff churn erasing venue character', 'noise and screens crowding out conversation'],
  },
  {
    id: 'travel', name: 'Travel',
    description: 'Tourism, mobility, and how people move through places.',
    customers: ['slow travellers avoiding the bucket list', 'remote workers living between cities', 'heritage and craft pilgrims'],
    behaviors: ['planning trips around one deep interest', 'choosing stays that feel inhabited, not staged', 'seeking neighbourhoods over landmarks'],
    frictions: ['overtourism flattening destinations', 'checklist itineraries driven by feeds', 'loyalty programs that reward frequency over meaning'],
  },
  {
    id: 'software', name: 'Software',
    description: 'Consumer apps, tools, and digital services.',
    customers: ['knowledge workers drowning in tabs', 'prosumers who customise everything', 'privacy-conscious early adopters'],
    behaviors: ['auditing subscriptions quarterly', 'choosing tools with strong opinions and restraint', 'paying for calm, focused software'],
    frictions: ['engagement-maximising design patterns', 'feature bloat hiding core value', 'lock-in and data extraction'],
  },
  {
    id: 'wellness', name: 'Wellness',
    description: 'Health, fitness, rest, and mental wellbeing.',
    customers: ['burnout-recovering professionals', 'sleep and nervous-system optimisers', 'community-first movers'],
    behaviors: ['treating rest as a skill to practice', 'joining run clubs as social infrastructure', 'tracking less, feeling more'],
    frictions: ['optimisation culture turning rest into work', 'loneliness despite hyperconnectivity', 'paywalled basics of feeling well'],
  },
  {
    id: 'dating', name: 'Dating',
    description: 'How people meet, court, and form relationships.',
    customers: ['app-fatigued twenty- and thirty-somethings', 'intentional daters seeking depth', 'people meeting through shared scenes'],
    behaviors: ['deleting apps and returning to introductions', 'meeting through run clubs, classes, and third places', 'slower, voice-first courtship'],
    frictions: ['swipe fatigue and choice paralysis', 'profile performance over personality', 'gamified matching that never resolves'],
  },
  {
    id: 'gaming', name: 'Gaming',
    description: 'Games, virtual worlds, and play as social space.',
    customers: ['cosy-game players seeking low stakes', 'world-builders and modders', 'friend groups who hang out inside games'],
    behaviors: ['treating games as third places', 'curating identity through avatars and spaces', 'valuing play sessions with no win state'],
    frictions: ['monetisation pressure breaking immersion', 'toxic lobbies and moderation gaps', 'grind mechanics replacing play'],
  },
  {
    id: 'media', name: 'Media',
    description: 'Publishing, newsletters, film, and attention.',
    customers: ['newsletter subscribers over feed scrollers', 're-watchers of comfort media', 'slow-journalism patrons'],
    behaviors: ['paying individual writers directly', 'choosing depth formats like essays and podcasts', 'curating personal archives of culture'],
    frictions: ['algorithmic feeds rewarding outrage', 'content churn with no memory', 'trust erosion in institutions'],
  },
  {
    id: 'food', name: 'Food & Beverage',
    description: 'How people cook, eat, drink, and gather.',
    customers: ['home cooks treating dinner as ritual', 'sober-curious socialisers', 'provenance-obsessed shoppers'],
    behaviors: ['hosting small dinners instead of going out', 'choosing low- and no-alcohol options', 'fermenting, baking, and preserving as hobbies'],
    frictions: ['convenience culture hollowing out skill', 'opaque supply chains', 'delivery apps replacing communal eating'],
  },
  {
    id: 'finance', name: 'Finance',
    description: 'Money, investing, and financial identity.',
    customers: ['first-generation investors', 'values-led savers', 'creator-economy earners with irregular income'],
    behaviors: ['learning money through communities, not institutions', 'aligning portfolios with beliefs', 'automating boring money decisions'],
    frictions: ['distrust of incumbent institutions', 'products designed for engagement over outcomes', 'financial advice locked behind wealth minimums'],
  },
  {
    id: 'work', name: 'Future of Work',
    description: 'How people work, collaborate, and build careers.',
    customers: ['portfolio-career builders', 'async-first remote teams', 'craft-obsessed specialists'],
    behaviors: ['unbundling jobs into projects', 'choosing depth over ladder-climbing', 'building public bodies of work'],
    frictions: ['always-on availability expectations', 'meetings crowding out craft', 'AI anxiety around creative roles'],
  },
  {
    id: 'retail', name: 'Retail & Commerce',
    description: 'Shops, marketplaces, and the act of buying.',
    customers: ['neighbourhood-loyal shoppers', 'resale and archive hunters', 'experience-seeking browsers'],
    behaviors: ['visiting stores as cultural destinations', 'buying less, buying with a story', 'trading and repairing before replacing'],
    frictions: ['identikit high streets', 'frictionless checkout removing the joy of browsing', 'returns logistics quietly destroying margins'],
  },
  {
    id: 'education', name: 'Education',
    description: 'Learning, skills, and curiosity across a lifetime.',
    customers: ['self-directed adult learners', 'career switchers in their thirties', 'craft-obsessed specialists'],
    behaviors: ['learning in public and cohort-based formats', 'choosing mentors over curricula', 'stacking micro-credentials with practice'],
    frictions: ['one-size-fits-all courses with no community', 'credential inflation', 'lonely, unfinishable self-paced content'],
  },
  {
    id: 'luxury', name: 'Luxury',
    description: 'High-end goods, services, and the meaning of premium.',
    customers: ['quiet-luxury connoisseurs', 'young collectors entering through archives', 'experience-over-object spenders'],
    behaviors: ['valuing discretion over logos', 'buying into worlds, not products', 'seeking provenance, repair, and permanence'],
    frictions: ['logo fatigue and conspicuous-consumption backlash', 'accessibility vs. exclusivity tension', 'experiences that feel templated'],
  },
  {
    id: 'social', name: 'Social Platforms',
    description: 'Networks, communities, and online belonging.',
    customers: ['group-chat natives avoiding public feeds', 'community moderators and hosts', 'creators seeking direct relationships'],
    behaviors: ['migrating to small, private spaces', 'curating close-friends layers', 'valuing moderation and shared norms'],
    frictions: ['scale destroying intimacy', 'algorithmic feeds over chronological connection', 'performance anxiety on public profiles'],
  },
];

export const INDUSTRY_MAP = new Map(INDUSTRIES.map((i) => [i.id, i]));

export function industryName(id: string): string {
  return INDUSTRY_MAP.get(id)?.name ?? id;
}
