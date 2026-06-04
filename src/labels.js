export const CONTENT_LABELS = [
    'sfw',
    'suggestive',
    'explicit',
    'mixed',
    'unknown',
];

export const ROUTE_LABELS = [
    'sfw',
    'nsfw',
    'unknown',
];

export const SFW_ACTION_LABELS = [
    'conversation',
    'walking',
    'running',
    'sitting',
    'standing',
    'eating',
    'drinking',
    'reading',
    'sleeping',
    'working',
    'studying',
    'cooking',
    'cleaning',
    'driving',
    'traveling',
    'shopping',
    'fighting',
    'dancing',
    'hugging',
    'crying',
    'laughing',
    'arguing',
    'unknown',
];

export const NSFW_ACTION_LABELS = [
    'flirting',
    'kissing',
    'touching',
    'fondling',
    'undressing',
    'posing',
    'grinding',
    'handjob',
    'blowjob',
    'cunnilingus',
    'oral sex',
    'vaginal sex',
    'anal sex',
    'intercourse',
    'masturbation',
    'mutual masturbation',
    'fingering',
    'restraint',
    'aftercare',
    'unknown',
];

export const NSFW_ACTION_GROUPS = {
    sensual: ['flirting', 'kissing', 'touching', 'fondling', 'undressing', 'posing', 'grinding'],
    oral: ['blowjob', 'cunnilingus', 'oral sex'],
    manual: ['handjob', 'fingering', 'masturbation', 'mutual masturbation'],
    penetrative: ['vaginal sex', 'anal sex', 'intercourse'],
    dynamic: ['restraint', 'aftercare'],
    unknown: ['unknown'],
};

export const NSFW_ACTION_ALIASES = {
    blowjob: ['blowjob', 'oral on penis', 'fellatio'],
    cunnilingus: ['cunnilingus', 'oral on vulva', 'going down'],
    handjob: ['handjob', 'manual stimulation'],
    fingering: ['fingering', 'manual penetration'],
    'vaginal sex': ['vaginal sex', 'penetrative sex', 'intercourse'],
    'anal sex': ['anal sex', 'anal penetration'],
    masturbation: ['masturbation', 'self stimulation'],
    'mutual masturbation': ['mutual masturbation'],
};

export const ALL_ACTION_LABELS = [...new Set([
    ...SFW_ACTION_LABELS,
    ...NSFW_ACTION_LABELS,
])];

export const ACTION_GROUP_LABELS = [
    'sfw',
    'sensual',
    'oral',
    'manual',
    'penetrative',
    'dynamic',
    'unknown',
];

export const POSE_LABELS = [
    'standing',
    'sitting',
    'kneeling',
    'lying',
    'straddling',
    'bending',
    'leaning',
    'spread legs',
    'restrained',
    'unknown',
];

export const EXPOSURE_LABELS = [
    'none',
    'chest',
    'buttocks',
    'genitals',
    'full nudity',
    'unknown',
];

export const CONTACT_LABELS = [
    'none',
    'mouth',
    'hands',
    'body',
    'genitals',
    'unknown',
];

export const ATTIRE_LABELS = [
    'clothed',
    'partial clothing',
    'underwear',
    'lingerie',
    'shirt',
    'pants',
    'dress',
    'nudity',
    'costume',
    'unknown',
];

export const LOCATION_LABELS = [
    'bedroom',
    'bathroom',
    'closet',
    'kitchen',
    'living room',
    'car',
    'shower',
    'bed',
    'couch',
    'floor',
    'table',
    'office',
    'outdoors',
    'unknown',
];

export const SETTING_LABELS = [
    'home',
    'bedroom',
    'bathroom',
    'vehicle',
    'office',
    'restaurant',
    'outdoors',
    'public place',
    'unknown',
];

export const AGE_LABELS = [
    'adult',
    'age unclear',
    'minor',
    'unknown',
];

export const CONSENT_LABELS = [
    'consensual',
    'roleplay',
    'coercive',
    'nonconsensual',
    'unclear',
    'unknown',
];

export const RISK_LABELS = [
    'none',
    'violence',
    'incest',
    'bestiality',
    'self harm',
    'illegal',
    'unknown',
];

export const NSFW_STATE_LABELS = [
    'none',
    'wet',
    'aroused',
    'messy',
    'after sex',
    'unknown',
];

export const APPEARANCE_DETAIL_LABELS = [
    'none',
    'wet',
    'messy',
    'sweaty',
    'flushed',
    'disheveled',
    'unknown',
];

export const FLUID_LABELS = [
    'none',
    'semen',
    'saliva',
    'sweat',
    'lubricant',
    'mixed fluids',
    'unknown',
];

export const FLUID_LOCATION_LABELS = [
    'none',
    'mouth',
    'face',
    'chest',
    'hands',
    'thighs',
    'genitals',
    'body',
    'clothing',
    'surface',
    'unknown',
];

export const CLOTHING_STATE_LABELS = [
    'normal',
    'removed',
    'partial',
    'ripped',
    'torn',
    'open',
    'pulled down',
    'pulled up',
    'unbuttoned',
    'unzipped',
    'disheveled',
    'stained',
    'wet',
    'unknown',
];

export const FLUID_ALIASES = {
    semen: ['semen', 'cum', 'ejaculate'],
    saliva: ['saliva', 'spit', 'drool'],
    sweat: ['sweat', 'perspiration'],
    lubricant: ['lube', 'lubricant'],
};

export const STATE_ALIASES = {
    wet: ['wet', 'slick', 'soaked'],
    messy: ['messy', 'covered', 'stained'],
    'after sex': ['afterglow', 'post sex', 'after sex'],
};

export const CLOTHING_STATE_ALIASES = {
    ripped: ['ripped', 'torn', 'shredded'],
    removed: ['removed', 'taken off', 'stripped off'],
    partial: ['half dressed', 'partially dressed', 'partial clothing'],
    open: ['open', 'spread open'],
    'pulled down': ['pulled down', 'lowered'],
    'pulled up': ['pulled up', 'lifted'],
    unbuttoned: ['unbuttoned', 'buttons undone'],
    unzipped: ['unzipped', 'zipper open'],
    disheveled: ['disheveled', 'messy clothing', 'rumpled'],
    stained: ['stained', 'marked'],
    wet: ['wet', 'soaked clothing'],
};

export const PROMPT_VERSION = 'v2-router-explicit-tags';
