    const API_BASE = '';

    const assFileInput = document.getElementById("ass-file");
    const uploadForm = document.getElementById("ass-upload-form");
    const trackNameInput = document.getElementById("track-name");
    const artistNameInput = document.getElementById("artist-name");
    const sourceTypeInput = document.getElementById("source-type");
    const durationInput = document.getElementById("audio-duration");
    const karaokeFxInput = document.getElementById("karaoke-fx");
    const uploadStatus = document.getElementById("upload-status");
    const uploadButton = uploadForm.querySelector("button[type='submit']");
    const feedContainer = document.getElementById("feed-container");

    function setUploadStatus(message, type = "info") {
      uploadStatus.textContent = message;
      uploadStatus.className = `min-h-[1.25rem] text-sm ${type === 'error' ? 'text-red-400' : type === 'success' ? 'text-emerald-400' : 'text-purple-300'}`;
    }

    function setUploading(isUploading) {
      uploadButton.disabled = isUploading;
      uploadButton.textContent = isUploading ? 'Uploading…' : 'Push to Cloud ☁️';
    }

    assFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.split("\n").filter(line => line.startsWith("Dialogue:"));
      if (!lines.length) {
        durationInput.value = "";
        return;
      }
      const lastLine = lines[lines.length - 1].split(",");
      const [h, m, s] = lastLine[2]?.trim().split(":") ?? [];
      if (!h || !m || !s) {
        durationInput.value = "";
        return;
      }
      durationInput.value = (parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s)).toFixed(2);
    });

    uploadForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const file = document.getElementById('ass-file').files[0];
      const trackName = document.getElementById('track-name').value.trim();
      const artistName = document.getElementById('artist-name').value.trim();
      const sourceType = document.getElementById('source-type').value;
      const duration = document.getElementById('audio-duration').value;
      const hasFx = document.getElementById('karaoke-fx').checked;

      if (!file) {
        setUploadStatus('Please choose a .ass file to upload.', 'error');
        return;
      }

      if (!trackName || !artistName || !duration) {
        setUploadStatus('Track, artist and duration are required.', 'error');
        return;
      }

      setUploading(true);
      setUploadStatus('Uploading file to backend API...', 'info');

      const body = new FormData();
      body.append('file', file);
      body.append('track_name', trackName);
      body.append('artist_name', artistName);
      body.append('source_type', sourceType);
      body.append('duration', duration);
      body.append('has_karaoke_fx', hasFx ? 'true' : 'false');

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body,
      });
      const result = await response.json();

      if (!response.ok) {
        setUploading(false);
        setUploadStatus('Upload error: ' + (result.error || response.statusText), 'error');
        return;
      }

      setUploadStatus('Upload successful! Refreshing feed…', 'success');
      await fetchDrops();
      uploadForm.reset();
      durationInput.value = '';
      setUploading(false);
    });

    async function fetchDrops(query = "") {
      const response = await fetch(`${API_BASE}/api/tracks?query=${encodeURIComponent(query)}`);
      const result = await response.json();

      if (!response.ok) {
        feedContainer.innerHTML = `<p class="text-red-500 text-sm">Error loading drops: ${result.error || response.statusText}</p>`;
        return;
      }

      if (!result.data || !result.data.length) {
        feedContainer.innerHTML = '<p class="text-zinc-500 text-sm text-center py-4">No drops yet. Upload the first .ass file!</p>';
        return;
      }

      feedContainer.innerHTML = result.data.map(track => `
        <div class="p-4 bg-zinc-950 rounded-xl border border-zinc-800 hover:border-purple-500 flex justify-between items-center">
          <div>
            <p class="font-bold">${track.track_name}</p>
            <p class="text-xs text-zinc-500 mt-1">${track.artist_name} • ${track.source_type}</p>
          </div>
          <div class="text-right">
            <span class="text-xs font-mono bg-zinc-800 px-2 py-1 rounded text-zinc-400">${track.duration}s</span>
            <a href="${track.file_url}" target="_blank" class="text-purple-400 text-xs mt-1 inline-block hover:underline">Download</a>
          </div>
        </div>
      `).join("");
    }

    document.getElementById("search-input").addEventListener("input", (e) => fetchDrops(e.target.value));
    fetchDrops();
