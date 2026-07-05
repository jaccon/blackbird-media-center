// Upload por chunks em ES5 para máxima compatibilidade com TVs antigas e navegadores legados
(function() {
  var fileInput = document.getElementById('fileInput');
  var uploadFilesBtn = document.getElementById('uploadFilesBtn');
  var CHUNK_SIZE = 5 * 1024 * 1024; // 5MB por chunk

  if (!uploadFilesBtn) return;

  uploadFilesBtn.addEventListener('click', function() {
    var files = fileInput.files;
    if (!files || !files.length) {
        if (window.Swal) {
            Swal.fire('Atenção!', 'Selecione pelo menos um arquivo.', 'warning');
        } else {
            alert('Selecione pelo menos um arquivo.');
        }
        return;
    }

    var currentPathEl = document.getElementById('currentPath');
    var currentPath = currentPathEl ? currentPathEl.value : '';
    var fileIndex = 0;

    function uploadNextFile() {
        if (fileIndex >= files.length) {
            fileInput.value = '';
            var modalEl = document.getElementById('uploadModal');
            if (modalEl) {
                if (window.bootstrap && bootstrap.Modal) {
                    var modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
                    if (modal) modal.hide();
                } else {
                    modalEl.classList.add('d-none');
                    modalEl.classList.remove('show');
                }
            }
            if (window.Swal) {
                Swal.fire('Sucesso!', 'Todos os arquivos foram enviados!', 'success').then(function() {
                    window.location.reload();
                });
            } else {
                alert('Todos os arquivos foram enviados!');
                window.location.reload();
            }
            return;
        }

        var file = files[fileIndex];
        var totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        var chunkIndex = 0;

        if (window.Swal) {
            Swal.fire({
                title: 'Enviando ' + file.name,
                text: 'Por favor, aguarde...',
                allowOutsideClick: false,
                didOpen: function() {
                    Swal.showLoading();
                }
            });
        }

        function uploadNextChunk() {
            if (chunkIndex >= totalChunks) {
                fileIndex++;
                uploadNextFile();
                return;
            }

            var start = chunkIndex * CHUNK_SIZE;
            var end = Math.min(start + CHUNK_SIZE, file.size);
            var chunk = file.slice(start, end);

            var url = '/upload-chunk?chunkIndex=' + chunkIndex +
                      '&totalChunks=' + totalChunks +
                      '&fileName=' + encodeURIComponent(file.name) +
                      '&currentPath=' + encodeURIComponent(currentPath);

            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');

            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    if (xhr.status === 200) {
                        try {
                            var result = JSON.parse(xhr.responseText);
                            if (result.success) {
                                chunkIndex++;
                                uploadNextChunk();
                            } else {
                                throw new Error(result.error || 'Erro desconhecido');
                            }
                        } catch (e) {
                            showError(file.name, e.message);
                        }
                    } else {
                        showError(file.name, 'Status HTTP ' + xhr.status);
                    }
                }
            };

            xhr.send(chunk);
        }

        uploadNextChunk();
    }

    function showError(fileName, errorMsg) {
        if (window.Swal) {
            Swal.fire('Erro!', 'Falha ao enviar ' + fileName + ': ' + errorMsg, 'error');
        } else {
            alert('Falha ao enviar ' + fileName + ': ' + errorMsg);
        }
    }

    uploadNextFile();
  });
})();

console.log("Gerenciador de arquivos carregado!");

window.startPermanentConversion = function(file) {
    if (!window.Swal) {
        alert('SweetAlert2 não está carregado. Por favor, certifique-se de carregar sweetalert2.all.min.js.');
        return;
    }

    Swal.fire({
        title: 'Converter MKV para MP4?',
        text: 'Este processo converterá permanentemente o vídeo MKV para um arquivo MP4 de alta compatibilidade no mesmo diretório. Você poderá excluir o arquivo MKV depois.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sim, Converter!',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#7c3aed',
        cancelButtonColor: '#334155',
        background: '#0f172a',
        color: '#f8fafc'
    }).then(function(result) {
        if (result.isConfirmed) {
            Swal.fire({
                title: 'Iniciando Conversão...',
                html: 'Preparando conversão de <b>' + file + '</b>.<br><br><div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden relative"><div id="convBar" class="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-full w-0 transition-all duration-300"></div></div><span id="convText" class="text-xs text-slate-400 mt-2 block font-mono">0%</span>',
                allowOutsideClick: false,
                allowEscapeKey: false,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#f8fafc',
                didOpen: function() {
                    Swal.showLoading();
                    
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', '/convert-to-mp4', true);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.onreadystatechange = function() {
                        if (xhr.readyState === 4) {
                            if (xhr.status === 200) {
                                try {
                                    var response = JSON.parse(xhr.responseText);
                                    if (response.success) {
                                        var hash = response.hash;
                                        
                                        var pollInterval = setInterval(function() {
                                            var statusXhr = new XMLHttpRequest();
                                            statusXhr.open('GET', '/conversion-status?hash=' + encodeURIComponent(hash), true);
                                            statusXhr.onreadystatechange = function() {
                                                if (statusXhr.readyState === 4) {
                                                    if (statusXhr.status === 200) {
                                                        try {
                                                            var statusResp = JSON.parse(statusXhr.responseText);
                                                            if (statusResp.success) {
                                                                var percent = statusResp.percent || 0;
                                                                var convBar = document.getElementById('convBar');
                                                                var convText = document.getElementById('convText');
                                                                if (convBar) convBar.style.width = percent + '%';
                                                                if (convText) convText.textContent = percent + '%';
                                                                
                                                                if (statusResp.finished) {
                                                                    clearInterval(pollInterval);
                                                                    if (statusResp.error) {
                                                                        Swal.fire({
                                                                            title: 'Erro!',
                                                                            text: 'Falha ao converter o vídeo: ' + statusResp.error,
                                                                            icon: 'error',
                                                                            confirmButtonColor: '#7c3aed',
                                                                            background: '#0f172a',
                                                                            color: '#f8fafc'
                                                                        });
                                                                    } else {
                                                                        Swal.fire({
                                                                            title: 'Sucesso!',
                                                                            text: 'Conversão concluída! O arquivo MP4 foi gerado no mesmo diretório.',
                                                                            icon: 'success',
                                                                            confirmButtonColor: '#7c3aed',
                                                                            background: '#0f172a',
                                                                            color: '#f8fafc'
                                                                        }).then(function() {
                                                                            window.location.reload();
                                                                        });
                                                                    }
                                                                }
                                                            }
                                                        } catch (e) {
                                                            clearInterval(pollInterval);
                                                            Swal.fire('Erro', 'Falha ao ler status da conversão.', 'error');
                                                        }
                                                    } else {
                                                        clearInterval(pollInterval);
                                                        Swal.fire('Erro', 'Falha ao ler status da conversão.', 'error');
                                                    }
                                                }
                                            };
                                            statusXhr.send();
                                        }, 2000);
                                    } else {
                                        Swal.fire('Erro', response.error || 'Falha ao iniciar conversão.', 'error');
                                    }
                                } catch (e) {
                                    Swal.fire('Erro', 'Falha ao processar resposta do servidor.', 'error');
                                }
                            } else {
                                try {
                                    var errResp = JSON.parse(xhr.responseText);
                                    Swal.fire('Erro', errResp.error || 'Erro ao se conectar com o servidor.', 'error');
                                } catch(e) {
                                    Swal.fire('Erro', 'Erro ao se conectar com o servidor.', 'error');
                                }
                            }
                        }
                    };
                    xhr.send(JSON.stringify({ file: file }));
                }
            });
        }
    });
};