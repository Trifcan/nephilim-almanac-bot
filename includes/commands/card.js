const Discord = require('discord.js');
const csv = require('csvtojson');
const Fuse = require('fuse.js');
const transliteration = require('transliteration');
const config = require('../../config.json');
const { readFile } = require('fs').promises;
const { configGet } = require('../helpers');
const player = require('../libs/player.js');
const spell = require('../libs/spell.js');

let cards;
let index;

function cleanString(string) {
  string = transliteration.transliterate(string);
  string = string.toLowerCase();
  string = string.replace(/[^a-z]/g, ' ').replace(/\s+/g, ' ');
  return string;
}

function cast(message, card)
{
    var result = player.info(message.author.id, message.channel.guild.id);
    if (typeof result === 'string' || result instanceof String)
    {
        return result;
    }
    return spell.cast(result, card);
}

function init() {
  csv({
    headers: ['name', 'file', 'book', 'type', 'credit'],
  })
    .fromFile('assets/cards.csv')
    .then((jsonObj) => {
      cards = jsonObj;
      for (let i in cards) {
        cards[i].index = cleanString(cards[i].name);
      }

      index = new Fuse(jsonObj, {
        threshold: 0.2,
        minMatchCharLength: 3,
        ignoreLocation: true,
        includeScore: true,
        keys: ['index'],
      });
    });
}

async function handle(command, msg) {
  if (command !== 'card') {
    return;
  }

  const params = msg.content.split(' ');

  if (params[1] === 'help') {
    readFile('./assets/card_help.md', {encoding: 'utf8'})
      .then((data) => {
        const embed = new Discord.MessageEmbed()
          .setTitle('Aide de la commande @card')
          .setDescription(data);
        msg.channel.send(embed);
      });
    return;
  }

  let results = [];

  // Card selected from its index.
  if (params.length === 2 && params[1].match(/^[0-9]+$/)) {
    const cid = Number(params[1]);
    if (cards[cid]) {
      results.push({
        item: cards[cid],
        refIndex: cid,
        score: 0,
      });
    }
  }
  // Card searched with keywords.
  if (results.length === 0) {
    const q = cleanString(params.slice(1).join(' '));
    results = index.search(q);
  }

  // Filter results to only keep the most relevant ones.
  results = reduceResults(results, 0.2);

  // Filter results to get those from enabled sets.
  const filteredResults = await filterResults(msg, results);

  // Format and send the results.
  msg.channel.send(formatResults(filteredResults, results));
}

/**
 * Filter results to only keep the more relevant ones.
 *
 * We iterate on results and stop when the diff between two scores is above 0.1.
 *
 * @param results array
 * @returns {*[]|*}
 */
function reduceResults(results) {
  if (!results.length) return results;

  let reducedResults = [];
  for (let i in results) {
    const j = Math.max(0, i - 1);
    const diffScore = results[i].score - results[j].score;
    if (diffScore > 0.1) {
      break;
    }
    reducedResults.push(results[i]);
  }

  return reducedResults;
}

/**
 * Filter result to remove cards form disabled sets.
 * @param msg Message
 * @param results array
 * @returns {PromiseLike<*[]>}
 */
function filterResults(msg, results) {
  return configGet(msg.guild.id, 'enabledSets', {})
    .then((data) => {
      let enabledSets = {};
      Object.keys(config.cardsSets).forEach((key) => {
        if (data[key]) {
          enabledSets[config.cardsSets[key]] = true;
        }
      });

      let filteredResults = [];
      for (let i in results) {
        const card = results[i].item;
        if (enabledSets[card.book]) {
          filteredResults.push(results[i]);
        }
      }

      return filteredResults;
    });
}

/**
 * Format the results to prepare the bot answer.
 * @param results array
 *   Filtered results.
 * @param allResults array
 *   All results (unfiltered).
 * @return string | Message
 */
function formatResults(results, allResults) {
  const diff = allResults.length - results.length;

  if (results.length === 0) {
    let message = [];
    message.push("Êtes-vous sûr⋅e de votre recherche ?");
    if (diff > 0) {
      message.push(`(${diff} résultat(s) supplémentaire(s) dans des ensembles désactivés sur ce serveur)`);
    }

    return new Discord.MessageEmbed()
      .setTitle("Aucune carte trouvée.")
      .setDescription(message.join("\n"));
  }
  else if (results.length === 1) {
    const card = results[0].item;
    var description = card.type;
    // description += "\n" + cast(message, card);
    return new Discord.MessageEmbed()
      .setTitle(card.name)
      .setDescription(description)
      .attachFiles([`assets/cards/${card.file}`])
      .setImage(`attachment://${card.file}`)
      .setFooter(`Crédit image : ${card.credit}`);
  }
  else {
    const summary = results.slice(0, 10);

    let message = [];
    if (summary.length < results.length) {
      message.push(`Voici les plus pertinents :`);
    }
    for (let i in summary) {
      const card = summary[i].item;
      message.push(`• [${summary[i].refIndex}] __${card.name}__`);
      message.push(`${card.type} - ${card.book}`);
    }

    message.push('');
    message.push(`Affinez votre recherche en ajoutant des mots ou tapez \`${config.prefix}card XXX\` si la carte que vous recherchez est dans la liste (XXX étant son numéro).`);
    if (diff > 0) {
      message.push(`*${diff} résultat(s) supplémentaire(s) dans des ensembles désactivés sur ce serveur*`);
    }

    return new Discord.MessageEmbed()
      .setTitle(`**${results.length}** résultats`)
      .setDescription(message.join("\n"));
  }
}

module.exports = {
  init,
  handle,
};
