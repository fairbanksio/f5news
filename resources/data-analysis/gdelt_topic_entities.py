"""Combine related headline stories around people named in the headlines."""
from collections import defaultdict
import re
import unicodedata


def _words(text):
    text = unicodedata.normalize('NFKD', text.casefold())
    text = ''.join(char for char in text if not unicodedata.combining(char))
    text = text.replace('’', "'").replace('‘', "'")
    text = re.sub(r"\b(\w+)'s\b", r'\1', text)
    text = text.replace("'", '')
    return tuple(re.findall(r'[^\W_]+', text, flags=re.UNICODE))


def _position(words, name):
    return next((index for index in range(len(words) - len(name) + 1)
                 if words[index:index + len(name)] == name), None)


def _subset(story, articles):
    result = dict(story)
    result.update(articles=articles, article_count=len(articles),
                  source_count=len({article.get('source', '') for article in articles}))
    return result


def umbrella_topics(stories, articles):
    """Build person topics, retaining semantic stories as nested groups.

    GKG names identify candidates, but only headline mentions assign articles.
    Surnames must identify one candidate and have a full-name headline anchor.
    Unnamed story groups survive; unnamed singletons stay outside these topics.
    """
    by_url = {article['url']: article for article in articles}
    articles = list(by_url.values())
    headlines = {article['url']: _words(article.get('title', '')) for article in articles}
    names = {}
    for article in articles:
        persons = article.get('persons', '') or ''
        persons = persons.split(';') if isinstance(persons, str) else persons
        for person in persons:
            if not isinstance(person, str):
                continue
            name = _words(person)
            if len(name) >= 2:
                names.setdefault(name, ' '.join(person.strip().split()).title())
    surnames = defaultdict(set)
    for name in names:
        surnames[name[-1]].add(name)
    anchored = {name for name in names
                if any(_position(words, name) is not None for words in headlines.values())}
    mentions = defaultdict(dict)
    for name in anchored:
        for url, words in headlines.items():
            position = _position(words, name)
            explicit = position is not None
            if position is None and len(surnames[name[-1]]) == 1:
                position = _position(words, name[-1:])
            if position is not None:
                mentions[name][url] = (position, explicit)
    coverage = {name: len({headlines[url] for url in matches})
                for name, matches in mentions.items()}
    frequency = {name: sum(words.count(name[-1]) for words in headlines.values())
                 for name in mentions}
    eligible = {name for name, matches in mentions.items() if len(matches) >= 2}
    while eligible:
        ownership = {}
        for url in by_url:
            candidates = [name for name in eligible if url in mentions[name]]
            if candidates:
                ownership[url] = min(candidates, key=lambda name: (
                    -coverage[name], mentions[name][url][0],
                    -frequency[name], name))
        retained = {name for name in eligible
                    if sum(owner == name for owner in ownership.values()) >= 2
                    and any(owner == name and mentions[name][url][1]
                            for url, owner in ownership.items())}
        if retained == eligible:
            break
        eligible = retained
    else:
        ownership = {}

    topics = []
    assigned = set(ownership)
    for name in sorted(eligible):
        matching = [article for article in articles if ownership.get(article['url']) == name]
        nested = []
        covered = set()
        for story in stories:
            members = [by_url[article['url']] for article in story['articles']
                       if ownership.get(article['url']) == name]
            if members:
                nested.append(_subset(story, members))
                covered.update(article['url'] for article in members)
        orphan_groups = defaultdict(list)
        for article in matching:
            if article['url'] not in covered:
                orphan_groups[headlines[article['url']]].append(article)
        for members in orphan_groups.values():
            nested.append(_subset(dict(name=members[0]['title'],
                                       summary='Articles about the same story.'), members))
        topics.append(dict(name=names[name], summary=f'News about {names[name]}.',
                           article_count=len(matching),
                           source_count=len({article.get('source', '') for article in matching}),
                           articles=matching, stories=nested, entity=True))
    for story in stories:
        remaining = []
        for article in story['articles']:
            url = article['url']
            if url in by_url and url not in assigned:
                remaining.append(by_url[url])
                assigned.add(url)
        if len(remaining) >= 2:
            topic = _subset(story, remaining)
            topic['stories'] = [_subset(story, remaining)]
            topic['entity'] = False
            topics.append(topic)
    return sorted(topics, key=lambda topic: (
        -topic['source_count'], -topic['article_count'], topic['name']))
