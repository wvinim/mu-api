/**
 * Gera src/data/itemDimensions.json a partir de docs/inv/Item.txt (tabela
 * de itens do client, fonte que o usuário forneceu). Precisamos disso pra
 * saber a largura/altura real (colunas X/Y do arquivo) de cada item —
 * sem isso, o scanner de slot vazio da mochila não sabe que um item 2x2
 * cobre 4 células visuais, mesmo ocupando só 1 slot no array binário do
 * Inventory (ver docs/INVENTORY_BYTE_FORMAT.md e o bug de produção
 * documentado em docs/SECTION_5_SHOP.md).
 *
 * Formato do Item.txt (por bloco de grupo):
 *   <número do grupo>
 *   //comentário com nomes de coluna
 *   <Index> <Slot> <Skill> <X> <Y> ... "<Nome>" ...
 *   ... (uma linha por item)
 *   end
 *
 * Rode de novo sempre que o Item.txt for atualizado:
 *   node scripts/generateItemDimensions.js
 */
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, '..', 'docs', 'inv', 'Item.txt');
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'itemDimensions.json');

function parseItemTxt(content) {
  const lines = content.split(/\r?\n/);
  const dimensions = {};
  let currentGroup = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line === 'end') {
      currentGroup = null;
      continue;
    }

    if (currentGroup === null) {
      if (/^\d+$/.test(line)) {
        currentGroup = Number(line);
      }
      // Linha de comentário ("//...") logo após o número do grupo — ignorada.
      continue;
    }

    if (line.startsWith('//')) continue;

    // Colunas separadas por espaço/tab: Index Slot Skill X Y Serial Opt Drop "Nome" ...
    const fields = line.split(/\s+/);
    const index = Number(fields[0]);
    const width = Number(fields[3]);
    const height = Number(fields[4]);
    const nameMatch = line.match(/"([^"]*)"/);
    const name = nameMatch ? nameMatch[1].trim() : null;

    if (!Number.isInteger(index) || !Number.isFinite(width) || !Number.isFinite(height)) {
      continue; // linha não reconhecida — não quebra o parse inteiro por uma linha ruim
    }

    dimensions[`${currentGroup}:${index}`] = { width, height, name };
  }

  return dimensions;
}

function main() {
  const content = fs.readFileSync(SOURCE_PATH, 'utf-8');
  const dimensions = parseItemTxt(content);

  const entryCount = Object.keys(dimensions).length;
  if (entryCount === 0) {
    throw new Error('Nenhuma entrada extraída de Item.txt — parser pode estar quebrado ou o arquivo mudou de formato.');
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(dimensions, null, 2) + '\n');
  console.log(`Gerado ${OUTPUT_PATH} com ${entryCount} itens.`);
}

main();
