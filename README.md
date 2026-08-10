# YouTube Ad Tool

Extension de navigateur qui place et nettoie les emplacements d'annonce mid-roll
dans YouTube Studio.

> À utiliser **une fois la vidéo publiée**, depuis ses paramètres → onglet
> **Monétisation** → *Vérifier le placement des mid-rolls*. L'extension ne sert à
> rien pendant l'envoi de la vidéo.

## Ce qu'elle fait

- **Auto** — enchaîne tout seul : remplissage, enregistrement, rechargement de la
  page, réouverture de l'éditeur, suppression des emplacements non validés par
  YouTube, puis réduction au nombre ou à la fréquence voulue.
- **Silence** — lit la forme d'onde publiée par l'éditeur et place une pub au
  milieu de chaque silence détecté.
- **Régulier** — une pub à intervalle fixe sur toute la vidéo.
- **Outils** — réduction manuelle, conversion des pubs automatiques en manuelles,
  suppression des emplacements invalides, remise à zéro.
- **Presets** — enregistre tes réglages et partage-les avec un code de 16
  caractères.

## Installation

1. Télécharge le `.zip` depuis la [dernière release](https://github.com/Slipers/youtube-ad-tool/releases/latest).
2. Décompresse-le.
3. Ouvre `chrome://extensions` (ou `opera://extensions`).
4. Active le **mode développeur**.
5. Clique sur **Charger l'extension non empaquetée** et choisis le dossier
   décompressé.

## Mises à jour

L'extension compare sa version à `version.json` de ce dépôt à chaque ouverture.
Quand une version plus récente est publiée, elle se verrouille et propose le
téléchargement.

Une extension chargée en mode développeur ne peut pas se mettre à jour toute
seule : après avoir téléchargé la nouvelle version, remplace le dossier puis
clique sur la flèche de rechargement dans la page des extensions.

## Permissions

| Permission | Pourquoi |
| --- | --- |
| `studio.youtube.com` | Lire et modifier les emplacements d'annonce de tes vidéos |
| `raw.githubusercontent.com` | Lire `version.json` pour détecter les mises à jour |
| `scripting`, `activeTab` | Exécuter les actions dans la page YouTube Studio |
| `storage` | Conserver tes réglages, presets et statistiques en local |

Aucune donnée ne quitte ton navigateur : les réglages restent en stockage local,
et la seule requête réseau sortante est la lecture du fichier de version.

## Licence

MIT — voir [LICENSE](LICENSE).
