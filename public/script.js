document.addEventListener('DOMContentLoaded', () => {
    const statusContainer = document.getElementById('status-container');
    const loadingMessage = document.getElementById('loading-message');
    const lastUpdatedElem = document.getElementById('last-updated');
    const repoLink = document.getElementById('repo-link');

    const repoOwner = 'krfoss';
    const repoName = 'kali-docs';
    repoLink.href = `https://github.com/${repoOwner}/${repoName}`;
    repoLink.textContent = `${repoOwner}/${repoName}`;

    async function fetchStatus() {
        try {
            const response = await fetch('/api/getStatus');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API Error: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }
            const data = await response.json();

            loadingMessage.style.display = 'none';

            if (data.length === 0) {
                statusContainer.innerHTML = '<p>번역 상태를 표시할 항목이 없습니다.</p>';
                return;
            }

            const ul = document.createElement('ul');
            data.forEach(item => {
                const li = document.createElement('li');
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'name';
                nameSpan.textContent = item.name;

                const statusSpan = document.createElement('span');
                statusSpan.className = `status-circle ${item.status}`;
                
                const link = document.createElement('a');
                link.href = item.url;
                link.target = '_blank';
                link.textContent = 'GitHub에서 보기';

                const leftDiv = document.createElement('div');
                leftDiv.appendChild(statusSpan);
                leftDiv.appendChild(nameSpan);
                
                li.appendChild(leftDiv);
                li.appendChild(link);
                ul.appendChild(li);
            });
            statusContainer.appendChild(ul);
            lastUpdatedElem.textContent = new Date().toLocaleString();

        } catch (error) {
            console.error('Failed to fetch status:', error);
            loadingMessage.textContent = `오류 발생: ${error.message}. 콘솔을 확인해주세요.`;
            loadingMessage.style.color = 'red';
        }
    }

    fetchStatus();
});
