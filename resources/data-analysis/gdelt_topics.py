"""Group a GDELT batch by readable tags and explicit headline mentions."""
from collections import defaultdict
import re
from urllib.parse import unquote, urlsplit

# Tags identify subjects mentioned in an article, not its sole main subject.
TOPICS = {
    'Elections': {'ELECTION'},
    'Government And Politics': {'GENERAL_GOVERNMENT', 'USPEC_POLITICS_GENERAL1', 'LEGISLATION'},
    'War And Conflict': {'ARMEDCONFLICT', 'MILITARY'},
    'Immigration': {'IMMIGRATION'},
    'Protests': {'PROTEST'},
    'Crime And Courts': {'TRIAL', 'SOC_GENERALCRIME'},
    'Health And Medicine': {'GENERAL_HEALTH', 'MEDICAL'},
    'Education': {'EDUCATION'},
    'Science': {'SCIENCE'},
    'Natural Disasters': {'NATURAL_DISASTER'},
    'Energy': {'ENV_OIL', 'ENV_GAS', 'ENV_COAL', 'WB_507_ENERGY_AND_EXTRACTIVES'},
    'Economy And Jobs': {'ECON_STOCKMARKET', 'ECON_UNEMPLOYMENT', 'WB_1921_PRIVATE_SECTOR_DEVELOPMENT', 'WB_701_JOBS', 'ECON_INFLATION'},
}


def article_label(article):
    if article.get('title', '').strip():
        return article['title'].strip(), 'headline'
    path = unquote(urlsplit(article['url']).path).strip('/').split('/')[-1]
    words = re.sub(r'[-_]+', ' ', path)
    return (words[:200] if len(words) > 15 else 'Open Article'), 'url'


def build_topics(payload):
    articles = []
    seen = set()
    for original in payload.get('articles', []):
        try:
            parsed = urlsplit(original.get('url', ''))
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or original['url'] in seen:
                continue
        except ValueError:
            continue
        seen.add(original['url'])
        article = dict(original)
        article['label'], article['label_kind'] = article_label(article)
        articles.append(article)
    groups = defaultdict(list)
    assigned = set()
    for article in articles:
        tags = set(article.get('themes', '').split(';'))
        for name, matches in TOPICS.items():
            if tags & matches:
                groups[name].append(article)
        title = article.get('title', '').casefold()
        for name in set(article.get('persons', '').split(';') + article.get('organizations', '').split(';')):
            name = name.strip()
            # A body-only mention or common single word cannot create a named topic.
            if len(name.split()) < 2 or len(name) > 60:
                continue
            if re.search(r'(?<!\w)' + re.escape(name.casefold()) + r'(?!\w)', title):
                groups[name.title()].append(article)
    topics = []
    for name, matching in groups.items():
        unique = {a['url']: a for a in matching}
        matching = list(unique.values())
        sources = {a['source'] for a in matching}
        if len(sources) < 2:
            continue
        assigned.update(unique)
        topics.append(dict(name=name, summary=('Articles tagged with this subject.' if name in TOPICS else 'Headlines mentioning this name.'), article_count=len(matching), source_count=len(sources), articles=matching))
    topics.sort(key=lambda t: (-t['source_count'], -t['article_count'], t['name']))
    return dict(fetched_at=payload['fetched_at'], country_note=payload.get('country_note', ''), article_count=len(articles), source_count=len({a['source'] for a in articles}), topics=topics, unassigned_count=sum(a['url'] not in assigned for a in articles), other_articles=[a for a in articles if a['url'] not in assigned], input_article_count=payload.get('input_article_count', len(articles)), excluded_articles=payload.get('excluded_articles', []))
