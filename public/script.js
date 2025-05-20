document.addEventListener('DOMContentLoaded', () => {
    const statusContainer = document.getElementById('status-container');
    const loadingMessage = document.getElementById('loading-message');
    const lastUpdatedElem = document.getElementById('last-updated');
    const repoLink = document.getElementById('repo-link');

    const repoOwner = 'krfoss';
    const repoName = 'kali-docs';
    repoLink.href = `https://github.com/${repoOwner}/${repoName}`;
    repoLink.textContent = `${repoOwner}/${repoName}`;

    function createNodeHtml(item) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'item-header';

        const statusCircle = document.createElement('span');
        statusCircle.className = `status-circle ${item.status}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = item.name;

        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.textContent = 'GitHub';
        link.className = 'github-link';

        itemDiv.appendChild(statusCircle);
        itemDiv.appendChild(nameSpan);
        itemDiv.appendChild(link);
        return itemDiv;
    }

    function buildList(items, parentElement) {
        const ul = document.createElement('ul');
        if (parentElement.tagName !== 'DIV' && parentElement.tagName !== 'MAIN') { // 최상위 ul이 아니면 들여쓰기
             ul.style.paddingLeft = '25px'; // 중첩 리스트 들여쓰기
        }


        items.forEach(item => {
            const li = document.createElement('li');

            if (item.isDir) {
                const details = document.createElement('details');
                const summary = document.createElement('summary');
                summary.appendChild(createNodeHtml(item)); // 이름, 상태, 링크를 summary에 표시
                details.appendChild(summary);

                if (item.children && item.children.length > 0) {
                    buildList(item.children, details); // 재귀 호출로 하위 리스트 생성
                } else {
                    // 자식이 없는 폴더 (예: index.md만 있거나, 아예 비었거나)
                    const noChildrenMsg = document.createElement('p');
                    noChildrenMsg.textContent = '(내용 없음 또는 index.md만 존재)';
                    noChildrenMsg.className = 'empty-dir-msg';
                    details.appendChild(noChildrenMsg);
                }
                li.appendChild(details);
            } else { // 파일인 경우 (주로 index.md)
                li.appendChild(createNodeHtml(item));
            }
            ul.appendChild(li);
        });
        parentElement.appendChild(ul);
    }

    async function fetchStatus() {
        try {
            const response = await fetch('/api/getStatus');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API Error: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }
            const data = await response.json();
            loadingMessage.style.display = 'none';

            if (!data || data.length === 0) {
                statusContainer.innerHTML = '<p>번역 상태를 표시할 항목이 없습니다. 저장소 루트에 디렉토리가 없거나 모두 제외되었을 수 있습니다.</p>';
                return;
            }

            buildList(data, statusContainer);
            lastUpdatedElem.textContent = new Date().toLocaleString();

        } catch (error) {
            console.error('Failed to fetch status:', error);
            loadingMessage.textContent = `오류 발생: ${error.message}. Vercel 로그와 브라우저 콘솔을 확인해주세요.`;
            loadingMessage.style.color = 'red';
        }
    }

    fetchStatus();
});
