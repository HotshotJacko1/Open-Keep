import urllib.request, json
req = urllib.request.Request('https://api.github.com/search/repositories?q=sqlcipher+spm+language:swift&sort=stars', headers={'User-Agent': 'Mozilla/5.0'})
data = json.loads(urllib.request.urlopen(req).read())
print('\n'.join([f"{r['html_url']} - {r['description']}" for r in data.get('items', [])[:5]]))
