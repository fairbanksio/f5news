"""Remove obvious non-news items from a small GDELT batch."""
import re

EXCLUSIONS = [
    ('Promotion Or Giveaway', r'\b(giveaway|win (?:your )?tickets|chances? to win|last chance to win)\b'),
    ('Quiz Or Puzzle', r'\b(quiz|crossword|spelling bee|connections hints|hints and answers|reveals your|your perfect)\b'),
    ('Advice Or Shopping', r'\b(dear abby|asking eric|wedding warning|how posh|wardrobe|fashion|swimwear|best dressed|vinted|you need to watch|things made|dishes to avoid|should never order|best pumpkin|auction deals|gift card|account manager|insurance journal jobs)\b'),
    ('Lists And Memes', r'\b(memes|spelling fails|funniest posts|fake online identities|historical photos|\d+ (wives|men|plane passengers))\b'),
    ('Entertainment', r'\b(marvel|avengers|wonder woman|sci fi|sci-fi|streaming home|streaming on|star on streaming|hot shots|sexy stars|pumpkin.head|k.pop|k-pop|grammy|friendly feud|hootie frutti|ain.t my problem|makeovers|box office|action flop|stranger things|scoob|halloween tradition|tribute to angry)\b'),
    ('Calendar Or Devotional', r'\b(today in history|devotional|catholic daily|study the bible|lord sets|gem and mineral show|midnight masquerade|music.assisted mindful|annual lambtown|stories from october)\b'),
]
EVENT = re.compile(r'\b(arrest\w*|charg(?:e|ed|es)|court|lawsuit|fraud|shooting|killed|kills|dies|death|crash|missing|rescue|fire|strike|attacks|war|election|polls|candidate|governor|trump|budget|funding|donation|hiring|inflation|trade|economic|economy|hospital|suicides|hiv|aids|launches|ministers|unemployment|job cuts|recall|earthquake|flood|hurricane|research|study finds|beats?|upsets?|win|wins|roundup)\b', re.I)
SUBJECT_TAGS = {'ELECTION','ARMEDCONFLICT','MILITARY','NATURAL_DISASTER','SOC_GENERALCRIME','LEGISLATION','PROTEST','IMMIGRATION'}


def news_reason(article):
    title = article.get('title', '').strip()
    if not title:
        return 'Missing Headline'
    for reason, pattern in EXCLUSIONS:
        if re.search(pattern, title, re.I):
            return reason
    if EVENT.search(title) or set(article.get('themes', '').split(';')) & SUBJECT_TAGS:
        return None
    return 'No Clear News Event In Headline'


def filter_news(payload):
    result = dict(payload)
    result['articles'] = []
    result['excluded_articles'] = []
    for article in payload['articles']:
        reason = news_reason(article)
        if reason:
            result['excluded_articles'].append(dict(url=article['url'], source=article['source'], label=article.get('title') or 'Missing Headline', reason=reason))
        else:
            result['articles'].append(article)
    result['input_article_count'] = len(payload['articles'])
    return result
