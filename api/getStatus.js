// api/getStatus.js
const fetch = require('node-fetch'); // Vercel 환경에 따라 Node.js 18+이면 global fetch 사용 가능

const GITHUB_TOKEN = process.env.GITHUB_API_KEY;
const REPO_OWNER = 'krfoss';
const REPO_NAME = 'kali-docs';
const ROOT_DOCS_PATH = ''; // 저장소 루트에서 시작

const EXCLUDED_ITEMS = [
    '.github', '.vuepress', 'readme.md', 'contributing.md', 'license',
    'package.json', 'package-lock.json', 'netlify.toml', 'node_modules',
    // 이미지나 기타 번역과 무관한 폴더/파일 추가
    'images', 'img', 'assets',
];

// GitHub API 호출 함수
async function fetchGitHubAPI(path) {
    const apiPath = path ? `contents/${path}` : 'contents';
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${apiPath}`;
    // console.log(`Fetching: ${url}`); // 디버깅 시 사용
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

// 파일 내용 가져오고 '번역:' 문자열 확인 (개별 index.md 파일용)
async function isIndexMdTranslated(filePath) {
    try {
        const fileData = await fetchGitHubAPI(filePath);
        if (fileData.type !== 'file' || typeof fileData.content === 'undefined') {
            console.warn(`Item at ${filePath} is not a file or has no content.`);
            return false; // 'red' 상태에 해당
        }
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        return content.includes('번역:'); // true면 'green', false면 'red'
    } catch (error) {
        console.warn(`Warning: Could not fetch or decode content for ${filePath}: ${error.message}`);
        return false;
    }
}

// 디렉토리 또는 파일의 상세 상태를 재귀적으로 가져오는 함수
async function getRecursiveItemStatus(itemEntry) {
    const { path: itemPath, name: itemName, type: itemType, html_url: itemUrl } = itemEntry;

    // 제외 목록 확인
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
        return null; // index.md가 아닌 파일은 결과에서 제외
    }

    // itemType === 'dir'
    let dirContents;
    try {
        dirContents = await fetchGitHubAPI(itemPath); // 디렉토리 내용 가져오기
        if (!Array.isArray(dirContents)) {
            console.warn(`Expected array for dir contents at ${itemPath}, got:`, dirContents);
            dirContents = [];
        }
    } catch (error) {
        // 디렉토리 접근 실패 시 (예: 권한 없음, 삭제된 경로 등)
        console.warn(`Failed to fetch contents for directory ${itemPath}: ${error.message}`);
        return { // 오류 발생 디렉토리는 'red'로 표시하고 하위 탐색 중단
            name: itemName,
            path: itemPath,
            url: itemUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${itemPath}`,
            status: 'red',
            isDir: true,
            children: [],
        };
    }

    const childPromises = dirContents.map(child => getRecursiveItemStatus(child));
    const childrenResults = (await Promise.all(childPromises)).filter(child => child !== null);

    // 현재 디렉토리의 종합 상태 결정
    let overallStatus = 'red'; // 기본값: 번역 안됨 또는 index.md 없음
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
    collectIndexMdFiles(childrenResults); // 현재 디렉토리의 직속 자식들로부터 시작

    if (indexMdFilesInSubtree.length > 0) {
        if (indexMdFilesInSubtree.every(s => s === 'green')) {
            overallStatus = 'green'; // 모든 index.md가 번역됨
        } else if (indexMdFilesInSubtree.some(s => s === 'green')) {
            overallStatus = 'yellow'; // 일부만 번역됨 (green과 red가 섞여 있음)
        } else {
            overallStatus = 'red'; // 모든 index.md가 번역 안됨
        }
    } else {
        // 이 디렉토리 및 하위에 index.md 파일이 전혀 없는 경우
        // 이 디렉토리 자체에도 index.md가 있는지 확인 (childrenResults에서 직접 찾아야 함)
        const directIndexMd = childrenResults.find(c => !c.isDir && c.name.toLowerCase() === 'index.md');
        if (directIndexMd) {
             overallStatus = directIndexMd.status; // 직속 index.md의 상태를 따름
        } else {
            overallStatus = 'red'; // 직속 index.md도 없고 하위에도 없음
        }
    }


    return {
        name: itemName,
        path: itemPath,
        url: itemUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${itemPath}`,
        status: overallStatus,
        isDir: true,
        children: childrenResults.sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 폴더 우선
            return a.name.localeCompare(b.name);
        }),
    };
}

export default async function handler(req, res) {
    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'GITHUB_API_KEY environment variable is not set.' });
    }

    try {
        const rootDirItems = await fetchGitHubAPI(ROOT_DOCS_PATH);
        if (!Array.isArray(rootDirItems)) {
            console.error("Root items is not an array:", rootDirItems);
            return res.status(500).json({ error: "Failed to fetch root directory structure from GitHub." });
        }

        const statusPromises = rootDirItems.map(item => {
            // 루트 아이템 중 디렉토리만 처리 (파일은 getRecursiveItemStatus에서 index.md 아니면 null 반환)
            if (item.type === 'dir') {
                 return getRecursiveItemStatus(item);
            }
            // 루트에 있는 index.md를 처리하려면 여기에 추가 (kali-docs는 루트에 index.md 없음)
            // else if (item.type === 'file' && item.name.toLowerCase() === 'index.md') {
            //    return getRecursiveItemStatus(item);
            // }
            return null;
        });

        const statuses = (await Promise.all(statusPromises))
            .filter(s => s !== null) // null이 아닌 결과만 (제외된 항목, index.md 아닌 파일 등 제외)
            .sort((a, b) => a.name.localeCompare(b.name));

        res.status(200).json(statuses);
    } catch (error) {
        console.error('Error in handler:', error);
        res.status(500).json({ error: error.message, stack: error.stack ? error.stack.toString() : 'No stack' });
    }
}
