# OB Scanner — Order Blocks 5 étoiles + RSI (XAUUSD & Bitcoin)

Scanner automatique qui détecte les **order blocks** (méthode des 5 étoiles)
sur l'**or (XAUUSD)** et le **Bitcoin**, sur plusieurs timeframes (5m, 15m, 1h),
ajoute le **RSI** comme bonus, et envoie une **alerte Telegram** quand un bon
setup apparaît.

---

## ⚠️ À lire d'abord : la question de TradingView

TradingView **ne fournit pas d'API publique** permettant à un programme Node de
récupérer les bougies de tes graphiques. Il n'existe pas de moyen officiel et
fiable de "brancher" du code dessus.

Ce programme récupère donc les **mêmes données de marché** via :
- **Bitcoin** → Binance (gratuit, public, fiable)
- **Or (XAUUSD)** → Twelve Data (clé gratuite à créer)

L'analyse (order blocks + RSI) est identique à ce que tu vois sur TradingView.
Seule la source des bougies change.

---

## Installation

```bash
npm install
```

## Configuration

Ouvre `src/config.js` et remplis :

### 1. Telegram
1. Sur Telegram, cherche **@BotFather** → `/newbot` → récupère le **TOKEN**
2. Écris un message à ton nouveau bot
3. Ouvre dans un navigateur :
   `https://api.telegram.org/bot<TON_TOKEN>/getUpdates`
   → trouve `"chat":{"id": ...}` = ton **chatId**

### 2. Twelve Data (pour l'or)
- Inscription gratuite sur https://twelvedata.com
- Récupère ta clé API (gratuit jusqu'à 800 requêtes/jour)
- Si tu ne veux scanner QUE le Bitcoin, retire la ligne XAUUSD
  dans `config.assets` et tu n'as pas besoin de cette clé.

Tu peux aussi mettre ces valeurs en variables d'environnement :
```bash
export TELEGRAM_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
export TWELVEDATA_KEY="..."
```

## Lancer

```bash
npm start
```

Le programme scanne en boucle (toutes les 60s par défaut) et t'envoie une
alerte Telegram dès qu'un order block atteint le score minimum (70/100 par défaut).

## Tester la logique (sans API)

```bash
npm test
```

---

## Comment marche le score

Chaque order block est noté sur **100 points** :

| Étoile | Critère | Points |
|--------|---------|--------|
| ⭐ | **Imbalance** : gap d'inefficience à la création | 20 |
| ⭐ | **Tendance** : OB dans le sens du marché | 20 |
| ⭐ | **Non mitigé** : jamais retouché depuis sa création | 20 |
| ⭐ | **Liquidité** : balayage d'un extrême juste avant | 20 |
| ⭐ | **Session volatile** : Europe ou US (pas l'Asie) | 20 |

**RSI en bonus** (jusqu'à +10) :
- +5 si le RSI confirme la direction (neutralité 50 : >50 haussier, <50 baissier)
- +5 si une divergence va dans le bon sens

Conformément à ton choix : **l'order block décide, le RSI est un bonus.**

## Réglages utiles (`src/config.js`)

- `timeframes` : ajoute/retire des unités de temps
- `detection.minScoreToAlert` : seuil d'alerte (baisse-le pour plus de signaux)
- `detection.impulseBodyMultiple` : sévérité de la détection d'impulsion
- `detection.alertCooldownMin` : évite de ré-alerter le même OB en boucle
- `scanIntervalSec` : fréquence du scan

---

## ⚠️ Avertissement

Cet outil est une **aide à la décision**, pas un conseil financier ni un
système qui prend des positions à ta place. Il identifie des zones selon une
méthode pédagogique tirée de vidéos YouTube. Le trading comporte un risque réel
de perte. Vérifie toujours toi-même sur ton graphique avant toute décision, et
ne risque que ce que tu peux te permettre de perdre.
