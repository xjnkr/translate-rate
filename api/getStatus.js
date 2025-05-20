// api/getStatus.js
const fetch = require('node-fetch'); // 또는 Node.js 18+ 환경이면 global fetch 사용 가능

const GITHUB_TOKEN = process.env.GITHUB_API_KEY;
const REPO_OWNER = 'krfoss';
const REPO_NAME = 'kali-docs';
const DOCS_PATH = ''; // 저장소 루트를 가리키도록 변경 (기존 'docs'에서 수정)

// 스캔에서 제외할 폴더 및 파일 목록 (소문자로)
const EXCLUDED_ITEMS = [
    '.github',
    '.vuepress',
    'readme.md', // 루트 README.md는 보통 개요이므로, 번역 상태 목록에서 제외 원하면 포함
    'contributing.md',
    'license',
    'package.json',
    'package-lock.json',
    'netlify.toml',
    // 기타 설정 파일이나 번역과 무관한 파일/폴더 추가 가능
];

// GitHub API 호출 함수
async function fetchGitHubAPI(path) {
    // path가 빈 문자열일 경우에도 GitHub API는 contents/ 뒤에 아무것도 없는 형태로 루트를 잘 인식합니다.
    // path가 있으면 'contents/path' 형태가 됩니다.
    const apiPath = path ? `contents/${path}` : 'contents';
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/${apiPath}`;
    
    console.log(`Fetching from GitHub API: ${url}`); // 디버깅용 로그

    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`GitHub API Error for path '${path}': ${response.status} - ${errorText}`);
        // 404 에러의 경우, 해당 경로에 파일/디렉토리가 없는 것이므로, 경우에 따라 다르게 처리할 수 있음
        // 여기서는 호출하는 쪽에서 처리하도록 에러를 그대로 throw
        throw new Error(`GitHub API Error: ${response.status} for path '${path}'`);
    }
    return response.json();
}

// 파일 내용 가져오고 '번역:' 문자열 확인
async function isFileTranslated(filePath) {
    try {
        const fileDataArray = await fetchGitHubAPI(filePath); // GitHub API는 파일 경로에 대해 배열로 응답하지 않음. 객체로 응답.
        // fetchGitHubAPI는 path에 대한 내용을 반환. 파일인 경우 파일 객체, 디렉토리인 경우 아이템 배열.
        // isFileTranslated는 파일 경로를 받으므로, 파일 객체를 기대해야 함.
        // 이 함수는 getDirectoryTranslationStatus 내에서 item.path (파일 경로)로 호출됨
        // 따라서 fetchGitHubAPI(filePath)는 해당 파일의 정보를 담은 객체를 반환해야 함.

        // filePath로 직접 파일 내용을 가져오는 API를 사용해야 함.
        // 위의 fetchGitHubAPI는 디렉토리 목록 또는 단일 파일 메타데이터용.
        // 파일 내용을 직접 가져오려면 Accept 헤더에 'application/vnd.github.VERSION.raw' 또는 base64 인코딩된 content를 파싱해야 함.
        // 현재 fetchGitHubAPI는 JSON을 반환하므로, content 필드를 사용.

        const fileData = await fetchGitHubAPI(filePath); // 이 filePath는 파일의 전체 경로여야 함.
                                                        // ex: "administration/index.md"

        if (fileData.type !== 'file' || typeof fileData.content === 'undefined') {
             // 간혹 API 응답이 예상과 다를 수 있으므로 content 존재 여부 확인
            console.warn(`Item at ${filePath} is not a file or has no content field.`);
            return false;
        }
        const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
        return content.includes('번역:');
    } catch (error) {
        // 파일이 없거나 (404), 접근 권한이 없거나, API 리밋 등 다양한 이유로 실패 가능
        console.warn(`Warning: Could not fetch or decode content for ${filePath}: ${error.message}`);
        return false; // 파일 접근 불가 시 번역 안됨으로 간주
    }
}

// 디렉토리 내의 index.md 파일들의 번역 상태를 재귀적으로 확인
async function getDirectoryTranslationStatus(dirPath) {
    let totalIndexMdFiles = 0;
    let translatedIndexMdFiles = 0;
    let filesToProcess = []; // 처리할 파일 목록 (index.md만)

    async function findIndexMdRecursive(currentPath) {
        let items;
        try {
            items = await fetchGitHubAPI(currentPath); // items는 배열이어야 함
            if (!Array.isArray(items)) { // 디렉토리가 아닌 단일 파일 등을 실수로 요청한 경우
                console.warn(`Expected array of items for directory ${currentPath}, but got:`, items);
                return;
            }
        } catch (error) {
            console.warn(`Warning: Could not fetch directory contents for ${currentPath}: ${error.message}`);
            return; // 디렉토리 접근 불가 시 (예: 404 Not Found for an empty or non-existent dir)
        }

        for (const item of items) {
            if (item.type === 'file' && item.name.toLowerCase() === 'index.md') {
                // isFileTranslated를 여기서 바로 호출하지 않고, 파일 경로만 수집
                filesToProcess.push(item.path);
            } else if (item.type === 'dir') {
                // 제외 목록에 있는 디렉토리 이름 또는 _로 시작하는 디렉토리 무시
                if (item.name.startsWith('_') || EXCLUDED_ITEMS.includes(item.name.toLowerCase())) {
                    continue;
                }
                await findIndexMdRecursive(item.path); // item.path는 '폴더명' 또는 '상위폴더/폴더명'
            }
        }
    }

    await findIndexMdRecursive(dirPath);

    if (filesToProcess.length === 0) {
        return 'red'; // 해당 디렉토리 및 하위에 index.md 파일이 하나도 없음
    }

    totalIndexMdFiles = filesToProcess.length;

    // 모아진 index.md 파일들의 번역 상태를 병렬로 확인 (API 호출 최적화)
    const translationChecks = filesToProcess.map(filePath => isFileTranslated(filePath));
    const results = await Promise.all(translationChecks);
    
    translatedIndexMdFiles = results.filter(isTranslated => isTranslated).length;

    if (totalIndexMdFiles === 0) return 'red'; // (위에서 이미 처리했지만, 안전장치)
    if (translatedIndexMdFiles === totalIndexMdFiles) return 'green';
    if (translatedIndexMdFiles > 0) return 'yellow';
    return 'red';
}

export default async function handler(req, res) {
    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'GITHUB_API_KEY environment variable is not set.' });
    }

    try {
        const rootDirItems = await fetchGitHubAPI(DOCS_PATH); // DOCS_PATH가 ''이므로 루트 컨텐츠를 가져옴
        const statuses = [];

        if (!Array.isArray(rootDirItems)) {
             console.error("Root items is not an array:", rootDirItems);
             return res.status(500).json({ error: "Failed to fetch root directory structure from GitHub."});
        }

        const directoriesToProcess = [];
        for (const item of rootDirItems) {
            // 디렉토리만 대상으로 하고, 제외 목록에 없는 것만 처리
            if (item.type === 'dir' && !EXCLUDED_ITEMS.includes(item.name.toLowerCase()) && !item.name.startsWith('_')) {
                directoriesToProcess.push(item);
            }
            // 만약 루트에 있는 특정 md 파일(예: introduction/index.md와는 별개로)도 처리하고 싶다면 여기에 로직 추가
            // else if (item.type === 'file' && item.name.toLowerCase() === 'some-root-file.md') { ... }
        }
        
        // 각 주요 디렉토리의 상태를 병렬로 가져오기
        const statusPromises = directoriesToProcess.map(async (dirItem) => {
            const dirStatus = await getDirectoryTranslationStatus(dirItem.path); // dirItem.path는 디렉토리 이름 (예: 'administration')
            return {
                name: dirItem.name,
                status: dirStatus,
                path: dirItem.path,
                url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${dirItem.path}`
            };
        });

        const resolvedStatuses = await Promise.all(statusPromises);
        statuses.push(...resolvedStatuses);

        res.status(200).json(statuses.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
        console.error('Error in handler:', error);
        res.status(500).json({ error: error.message, stack: error.stack ? error.stack.toString() : 'No stack available' });
    }
}
