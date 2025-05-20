// api/getStatus.js
const fetch = require('node-fetch'); // 또는 Node.js 18+ 환경이면 global fetch 사용 가능

const GITHUB_TOKEN = process.env.GITHUB_API_KEY;
const REPO_OWNER = 'krfoss';
const REPO_NAME = 'kali-docs';
const ROOT_DOCS_PATH = '';

const EXCLUDED_ITEMS = [
    '.github', '.vuepress', 'readme.md', 'contributing.md', 'license',
    'package.json', 'package-lock.json', 'netlify.toml', 'node_modules',
    'images', 'img', 'assets',
];

// GitHub API 호출 함수 (기존과 동일)
async function fetchGitHubAPI(path) {
    const apiPath = path ? `contents/${path}` : 'contents';
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${apiPath}`;
    // console.log(`Fetching: ${url}`);
    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`GitHub API Error for path '${path}': ${response.status} - ${errorText}`);
        throw new Error(`GitHub API Error: ${response.status} for path '${path}'`);
    }
    return response.json();
}

// 파일 내용 가져오고 '번역:' 문자열 확인 (기존과 동일)
async function isIndexMdTranslated(filePath) {
    try {
        const fileData = await fetchGitHubAPI(filePath);
        if (fileData.type !== 'file' || typeof fileData.content === 'undefined') {
            console.warn(`Item at ${filePath} is not a file or has no content.`);
            return false;
        }
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        return content.includes('번역:');
    } catch (error) {
        console.warn(`Warning: Could not fetch or decode content for ${filePath}: ${error.message}`);
        return false;
    }
}

// 디렉토리 또는 파일의 상세 상태를 재귀적으로 가져오는 함수 (기존과 동일)
async function getRecursiveItemStatus(itemEntry) {
    const { path: itemPath, name: itemName, type: itemType, html_url: itemUrl } = itemEntry;

    if (EXCLUDED_ITEMS.includes(itemName.toLowerCase()) || itemName.startsWith('_')) {
        return null;
    }

    if (itemType === 'file') {
        if (itemName.toLowerCase() === 'index.md') {
            const translated = await isIndexMdTranslated(itemPath);
            return {
                name: itemName,
                path: itemPath,
                url: itemUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/master/${itemPath}`,
                status: translated ? 'green' : 'red',
                isDir: false,
                children: [],
            };
        }
        return null;
    }

    let dirContents;
    try {
        dirContents = await fetchGitHubAPI(itemPath);
        if (!Array.isArray(dirContents)) {
            console.warn(`Expected array for dir contents at ${itemPath}, got:`, dirContents);
            dirContents = [];
        }
    } catch (error) {
        console.warn(`Failed to fetch contents for directory ${itemPath}: ${error.message}`);
        return {
            name: itemName,
            path: itemPath,
            url: itemUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${itemPath}`,
            status: 'red', // 오류 발생 시 디렉토리 상태 red
            isDir: true,
            children: [],
        };
    }

    const childPromises = dirContents.map(child => getRecursiveItemStatus(child));
    const childrenResults = (await Promise.all(childPromises)).filter(child => child !== null);

    let overallStatus = 'red';
    const indexMdFilesInSubtree = [];
    function collectIndexMdFiles(nodes) {
        for (const node of nodes) {
            if (!node.isDir && node.name.toLowerCase() === 'index.md') {
                indexMdFilesInSubtree.push(node.status);
            }
            if (node.isDir && node.children.length > 0) {
                collectIndexMdFiles(node.children);
            }
        }
    }
    const directIndexMdInCurrentDir = childrenResults.find(c => !c.isDir && c.name.toLowerCase() === 'index.md');
    if (directIndexMdInCurrentDir) {
        indexMdFilesInSubtree.push(directIndexMdInCurrentDir.status);
    }
    collectIndexMdFiles(childrenResults.filter(c => c.isDir));


    if (indexMdFilesInSubtree.length > 0) {
        if (indexMdFilesInSubtree.every(s => s === 'green')) {
            overallStatus = 'green';
        } else if (indexMdFilesInSubtree.some(s => s === 'green' || s === 'yellow')) { // 자식 폴더가 yellow일 수도 있음
            overallStatus = 'yellow';
        } else {
            overallStatus = 'red';
        }
    } else {
         overallStatus = 'red'; // index.md 파일이 전혀 없음
    }


    return {
        name: itemName,
        path: itemPath,
        url: itemUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${itemPath}`,
        status: overallStatus,
        isDir: true,
        children: childrenResults.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
        }),
    };
}


export default async function handler(req, res) {
    if (!GITHUB_TOKEN) {
        // 환경 변수 미설정 오류는 짧게 캐시
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120'); // 1분 캐시, 2분간 stale 허용
        return res.status(500).json({ error: 'GITHUB_API_KEY environment variable is not set.' });
    }

    try {
        const rootDirItems = await fetchGitHubAPI(ROOT_DOCS_PATH);
        if (!Array.isArray(rootDirItems)) {
            console.error("Root items is not an array:", rootDirItems);
            // 이 오류도 짧게 캐시
            res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
            return res.status(500).json({ error: "Failed to fetch root directory structure from GitHub." });
        }

        const statusPromises = rootDirItems.map(item => {
            if (item.type === 'dir') {
                 return getRecursiveItemStatus(item);
            }
            return null;
        });

        const statuses = (await Promise.all(statusPromises))
            .filter(s => s !== null)
            .sort((a, b) => a.name.localeCompare(b.name));

        // 성공적인 응답에 대한 캐시 설정
        // s-maxage=600: Vercel Edge 캐시에 10분간 저장
        // stale-while-revalidate=1800: 10분 후부터 추가 30분간은 만료된 캐시를 먼저 보여주고 백그라운드에서 갱신
        res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800');
        res.status(200).json(statuses);

    } catch (error) {
        console.error('Error in handler:', error);
        // API 속도 제한(403) 또는 기타 서버 오류 발생 시 짧게 캐시
        const statusCode = error.message && error.message.includes('403') ? 403 : 500;
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120'); // 1분 캐시
        res.status(statusCode).json({
            error: `Failed to process translation statuses: ${error.message}`,
            stack: error.stack ? error.stack.toString() : 'No stack available'
        });
    }
}
