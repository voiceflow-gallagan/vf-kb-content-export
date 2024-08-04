// import { fetch } from 'bun';
import { writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import readline from 'readline';
import JSZip from 'jszip';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const DEFAULT_DOMAIN = 'api.voiceflow.com';
const BASE_PATH = '/v1/knowledge-base';
const EXPORT_DIR = './exports';

async function getDomain(): Promise<string> {
  const answer = await new Promise<string>((resolve) => {
    rl.question('Enter custom domain (or press Enter for default): ', (answer) => {
      resolve(answer.trim());
    });
  });

  if (answer === '') {
    return DEFAULT_DOMAIN;
  }
  return `api.${answer}.voiceflow.com`;
}

async function getApiKey(): Promise<string> {
  while (true) {
    const apiKey = await new Promise<string>((resolve) => {
      rl.question('Enter your API key: ', (answer) => {
        resolve(answer.trim());
      });
    });

    if (apiKey.startsWith('VF.DM.')) {
      return apiKey;
    } else {
      console.log('Invalid API key. It must start with "VF.DM.". Please try again.');
    }
  }
}

async function fetchDocs(baseUrl: string, apiKey: string, page = 1): Promise<any> {
  const response = await fetch(`${baseUrl}/docs?page=${page}&limit=100`, {
    headers: { Authorization: apiKey }
  });
  return response.json();
}

async function fetchDocContent(baseUrl: string, apiKey: string, documentID: string): Promise<any> {
  const response = await fetch(`${baseUrl}/docs/${documentID}`, {
    headers: { Authorization: apiKey }
  });
  return response.json();
}

// Change the parseTableContent function to use dedicated parser logic if needed
function parseTableContent(chunks: any[]): string {
  const sanitizedChunks = chunks.map(({ chunkID, ...rest }) => rest);
  return JSON.stringify(sanitizedChunks, null, 2); // Save chunks in their original format (JSON)
}

// Change the parseUrlContent function to use dedicated parser logic if needed
function parseUrlContent(chunks: any[]): string {
  return chunks.map(chunk => chunk.content).join('\n');
}

// Change the parseContent (generic) function to use dedicated parser logic if needed
function parseContent(chunks: any[]): string {
  return chunks.map(chunk => chunk.content).join('\n');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase().replace(/^\.+/, '');
}

async function createDateTimeSubDir() {
  const now = new Date();
  const dateTime = now.toISOString().replace(/[:T]/g, '-').split('.')[0]; // Format: YYYY-MM-DD-HH-mm-ss
  const subDir = path.join(EXPORT_DIR, dateTime);
  await mkdir(subDir, { recursive: true });
  console.log(`Created subdirectory: ${subDir}`);
  return subDir;
}

async function ensureZipDirExists(subDir: string) {
  const zipDir = path.join(subDir, 'zip');
  await mkdir(zipDir, { recursive: true });
  console.log(`Created zip directory: ${zipDir}`);
  return zipDir;
}

async function processDoc(baseUrl: string, apiKey: string, doc: any, subDir: string) {
  const content = await fetchDocContent(baseUrl, apiKey, doc.documentID);
  let parsedContent = '';
  let fileExtension = '.txt';

  // Update this to handle other doc types and use dedicated parser if needed
  if (doc.data.type === 'table') {
    parsedContent = parseTableContent(content.chunks);
    fileExtension = '.json';
  } else if (doc.data.type === 'url') {
    parsedContent = parseUrlContent(content.chunks);
  } else {
    parsedContent = parseContent(content.chunks);
  }

  const sanitizedName = sanitizeFileName(doc.data.name);
  const fileName = path.join(subDir, `${sanitizedName}${fileExtension}`);
  const safeFilePath = path.normalize(fileName).replace(/^(\.\.[\/\\])+/, '');
  await writeFile(safeFilePath, parsedContent);
  console.log(`Created file: ${safeFilePath}`);
}

async function createZipOfExportedDocs(subDir: string, zipDir: string) {
  const zip = new JSZip();
  const files = await readdir(subDir);

  for (const file of files) {
    if (path.extname(file) === '.txt') {
      const content = await readFile(path.join(subDir, file));
      zip.file(file, content);
    }
  }

  const zipContent = await zip.generateAsync({ type: "nodebuffer" });
  const zipFileName = path.join(zipDir, `exported_docs_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
  await writeFile(zipFileName, zipContent);
  console.log(`Created zip file: ${zipFileName}`);
}

async function main() {
  const domain = await getDomain();
  const baseUrl = `https://${domain}${BASE_PATH}`;
  const apiKey = await getApiKey();
  const subDir = await createDateTimeSubDir();
  const zipDir = await ensureZipDirExists(subDir);
  let page = 1;
  let totalDocs = 0;

  do {
    const docsResponse = await fetchDocs(baseUrl, apiKey, page);
    totalDocs = docsResponse.total;

    for (const doc of docsResponse.data) {
      if(doc.status.type === 'SUCCESS') {
        await processDoc(baseUrl, apiKey, doc, subDir);
      }
    }

    page++;
  } while ((page - 1) * 100 < totalDocs);

  await createZipOfExportedDocs(subDir, zipDir);

  rl.close();
}

main().catch(console.error);
