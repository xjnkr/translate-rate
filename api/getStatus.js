// api/getStatus.js
const fetch = require('node-fetch'); // node-fetch v2 사용 시, v3는 import 방식 다름

const GITHUB_TOKEN = process.env.GITHUB_API_KEY; // Vercel 환경 변수에서 가져옴
const REPO_OWNER = 'krfoss';
const REPO_NAME = 'kali-docs';
const DOCS_PATH = 'docs'; // kali-docs 저장소 내 실제 문서 경로 (예: 'docs')

// GitHub API 호출 함수
async function fetchGitHubAPI(path) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) {
        const errorData = await response.text();
        console.error(`GitHub API Error for path ${path}: ${response.status} ${errorData}`);
        throw new Error(`GitHub API Error: ${response.status}`);
    }
    return response.json();
}

// 파일 내용 가져오고 '번역:' 문자열 확인
async function isFileTranslated(filePath) {
    try {
        const fileData = await fetchGitHubAPI(filePath);
        if (fileData.type !== 'file' || !fileData.content) {
            return false;
        }
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        return content.includes('번역:');
    } catch (error) {
        console.warn(`Warning: Could not fetch or decode content for ${filePath}: ${error.message}`);
        return false; // 파일 접근 불가 시 번역 안됨으로 간주
    }
}

// 디렉토리 내의 index.md 파일들의 번역 상태를 재귀적으로 확인
async function getDirectoryTranslationStatus(dirPath) {
    let totalIndexMdFiles = 0;
    let translatedIndexMdFiles = 0;

    async function findIndexMdRecursive(currentPath) {
        const items = await fetchGitHubAPI(currentPath);
        for (const item of items) {
            if (item.type === 'file' && item.name.toLowerCase() === 'index.md') {
                totalIndexMdFiles++;
                if (await isFileTranslated(item.path)) {
                    translatedIndexMdFiles++;
                }
            } else if (item.type === 'dir') {
                // 특정 파일(예: _Sidebar.md, _Footer.md) 무시
                if (item.name.startsWith('_')) continue;
                await findIndexMdRecursive(item.path);
            }
        }
    }

    await findIndexMdRecursive(dirPath);

    if (totalIndexMdFiles === 0) return 'red'; // index.md 파일이 하나도 없음
    if (translatedIndexMdFiles === totalIndexMdFiles) return 'green'; // 모두 번역됨
    if (translatedIndexMdFiles > 0) return 'yellow'; // 부분 번역됨
    return 'red'; // 하나도 번역 안됨
}

export default async function handler(req, res) {
    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'GITHUB_API_KEY environment variable is not set.' });
    }

    try {
        const rootItems = await fetchGitHubAPI(DOCS_PATH);
        const statuses = [];

        // 1. DOCS_PATH (예: 'docs') 자체의 index.md 확인 (존재한다면)
        const rootIndexMd = rootItems.find(item => item.type === 'file' && item.name.toLowerCase() === 'index.md' && item.path === `${DOCS_PATH}/index.md`);
        if (rootIndexMd) {
            const translated = await isFileTranslated(rootIndexMd.path);
            statuses.push({
                name: `(루트 ${DOCS_PATH}/index.md)`, // 예: (루트 docs/index.md)
                status: translated ? 'green' : 'red',
                path: rootIndexMd.path,
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/master/${rootIndexMd.path}`
            });
        }

        // 2. DOCS_PATH 하위 디렉토리들 확인
        for (const item of rootItems) {
            if (item.type === 'dir') {
                 // 특정 파일(예: _Sidebar.md, _Footer.md) 무시
                if (item.name.startsWith('_')) continue;

                const dirStatus = await getDirectoryTranslationStatus(item.path);
                statuses.push({
                    name: item.name,
                    status: dirStatus,
                    path: item.path,
                    url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${item.path}`
                });
            }
        }

        res.status(200).json(statuses.sort((a, b) => a.name.localeCompare(b.name))); // 이름순 정렬
    } catch (error) {
        console.error('Error in handler:', error);
        res.status(500).json({ error: error.message, stack: error.stack });
    }
}
