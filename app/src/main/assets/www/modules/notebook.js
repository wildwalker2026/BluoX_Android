// ==================== 笔记功能（手机端）v2 ====================
(function () {
    var notebookModal = document.getElementById('notebookModal');
    var notebookEditModal = document.getElementById('notebookEditModal');
    var notebookOpenBtn = document.getElementById('notebookOpenBtn');
    var closeNotebook = document.getElementById('closeNotebook');
    var closeNotebookEdit = document.getElementById('closeNotebookEdit');
    var notebookList = document.getElementById('notebookList');
    var addNoteBtn = document.getElementById('addNoteBtn');
    var notebookGetBtn = document.getElementById('notebookGetBtn');
    var editTitle = document.getElementById('notebookEditTitle');
    var textarea = document.getElementById('notebookTextarea');
    var editSyncBtn = document.getElementById('notebookEditSyncBtn');
    var contentDiv = document.getElementById('notebookContent');

    var editingIndex = -1;
    var editingTitle = '';
    var noteModified = 0; // 0=未修改，1=已修改

    // ---------- 批量选择模式状态 ----------
    var batchMode = false;
    var batchSelected = new Set();
    var longPressTimer = null;
    var longPressTriggered = false;

    // ---------- 笔记持久化（TXT文件） ----------

    // 清理旧的IndexedDB数据
    try {
        var req = indexedDB.deleteDatabase('BluoxNotebook');
        req.onsuccess = function() { console.log('[笔记] 已清理旧IndexedDB数据'); };
    } catch(e) {}

    function loadNotes() {
        try {
            if (window.AndroidBridge && window.AndroidBridge.readAllNoteFiles) {
                var json = window.AndroidBridge.readAllNoteFiles();
                if (json !== null && json !== undefined) {
                    var notes = JSON.parse(json);
                    if (notes) {
                        return Promise.resolve(notes);
                    }
                }
            }
        } catch (e) {
            console.error('[笔记] 读取本地文件失败:', e);
        }
        return Promise.resolve([]);
    }

    function saveNotes(notes, syncIndex) {
        // 同步指定笔记到TXT文件
        if (typeof syncIndex === 'number' && syncIndex >= 0 && notes[syncIndex]) {
            syncNoteToFile(notes[syncIndex]);
        }
        return Promise.resolve();
    }

    function syncNoteToFile(note) {
        try {
            if (!window.AndroidBridge || !window.AndroidBridge.saveNoteFile || !note) return;
            var title = note.title || '未命名';
            var content = (note.pinned ? 'pinned:true' : 'pinned:false') + '\n' + (note.content || '');
            window.AndroidBridge.saveNoteFile(title, content);
        } catch (e) {
            console.error('[笔记] 同步文件失败:', e);
        }
    }

    function deleteNoteFile(title) {
        try {
            if (window.AndroidBridge && window.AndroidBridge.deleteNoteFile) {
                window.AndroidBridge.deleteNoteFile(title);
            }
        } catch (e) {
            console.error('[笔记] 删除文件失败:', e);
        }
    }

    function renameNoteFile(oldTitle, newTitle) {
        try {
            if (window.AndroidBridge && window.AndroidBridge.renameNoteFile) {
                window.AndroidBridge.renameNoteFile(oldTitle, newTitle);
            }
        } catch (e) {
            console.error('[笔记] 重命名文件失败:', e);
        }
    }

    // ---------- 渲染笔记列表 ----------

    function renderNoteList(notes) {
        var items = notebookList.querySelectorAll('.agent-item');
        items.forEach(function (item) { item.remove(); });

        // 排序：置顶的排前面，其余按时间倒序
        var sorted = notes.map(function (note, index) { return { note: note, index: index }; });
        sorted.sort(function (a, b) {
            var aPinned = a.note.pinned ? 1 : 0;
            var bPinned = b.note.pinned ? 1 : 0;
            if (aPinned !== bPinned) return bPinned - aPinned;
            return (b.note.time || 0) - (a.note.time || 0);
        });

        sorted.forEach(function (item) {
            var note = item.note;
            var index = item.index;
            var noteDiv = document.createElement('div');
            noteDiv.className = 'agent-item';
            noteDiv.dataset.noteTitle = note.title || '未命名';

            // 批量模式下：已选中复用 .active（实线边框），未选中用内联虚线
            if (batchMode) {
                if (batchSelected.has(note.title || '未命名')) {
                    noteDiv.classList.add('active');
                    noteDiv.style.border = '';
                } else {
                    noteDiv.style.border = '1px dashed var(--border-color)';
                }
            } else if (note.pinned) {
                noteDiv.classList.add('active');
            }

            var infoDiv = document.createElement('div');
            infoDiv.className = 'agent-item-info';
            var title = note.title || '无标题';
            var preview = note.content ? note.content.substring(0, 40) : '空笔记';
            var timeStr = '';
            if (note.time) {
                var d = new Date(note.time);
                var pad = function(n) { return n < 10 ? '0' + n : n; };
                timeStr = ' -' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
            }
            infoDiv.innerHTML =
                '<span class="agent-item-name">' + escapeHtml(title) + '<span style="font-size:12px;color:var(--text-secondary);font-weight:normal;">' + escapeHtml(timeStr) + '</span></span>' +
                '<span class="agent-item-desc">' + escapeHtml(preview) + '</span>';
            noteDiv.appendChild(infoDiv);

            // ---------- 点击事件：批量模式 vs 正常模式 ----------
            var noteTitle = note.title || '未命名';
            noteDiv.addEventListener('click', function () {
                if (batchMode) {
                    toggleBatchSelect(noteTitle);
                    return;
                }
                openEditView(note, index);
            });

            // ---------- 长按触发批量选择模式 ----------
            noteDiv.addEventListener('touchstart', function (e) {
                longPressTriggered = false;
                longPressTimer = setTimeout(function () {
                    longPressTriggered = true;
                    enterBatchMode(noteTitle);
                }, 600);
            });
            noteDiv.addEventListener('touchend', function () {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });
            noteDiv.addEventListener('touchmove', function () {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });
            // PC端鼠标长按
            noteDiv.addEventListener('mousedown', function (e) {
                if (e.button !== 0) return;
                longPressTriggered = false;
                longPressTimer = setTimeout(function () {
                    longPressTriggered = true;
                    enterBatchMode(noteTitle);
                }, 600);
            });
            noteDiv.addEventListener('mouseup', function () {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });
            noteDiv.addEventListener('mouseleave', function () {
                if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
            });

            var menuBtn = document.createElement('button');
            menuBtn.className = 'agent-item-menu-btn';
            menuBtn.innerHTML =
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '    <circle cx="12" cy="12" r="1"></circle>' +
                '    <circle cx="12" cy="5" r="1"></circle>' +
                '    <circle cx="12" cy="19" r="1"></circle>' +
                '</svg>';
            menuBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (batchMode) return;
                if (typeof createBottomSheetPicker === 'function') {
                    createBottomSheetPicker({
                        items: [
                            { value: 'pin', label: note.pinned ? '取消置顶' : '置顶' },
                            { value: 'rename', label: '编辑标题' },
                            'divider',
                            { value: 'delete', label: '删除', className: 'bs-item-danger' }
                        ],
                        onSelect: function (item) {
                            if (item.value === 'pin') {
                                loadNotes().then(function (notes) {
                                    notes[index].pinned = !notes[index].pinned;
                                    return saveNotes(notes, index);
                                }).then(function () {
                                    return loadNotes();
                                }).then(function (notes) {
                                    renderNoteList(notes);
                                });
                            } else if (item.value === 'rename') {
                                if (typeof createBottomSheetInput === 'function') {
                                    createBottomSheetInput({
                                        title: '编辑标题',
                                        placeholder: '输入笔记标题',
                                        value: note.title || '',
                                        inputType: 'text',
                                        maxLength: 50,
                                        confirmText: '确定',
                                        onConfirm: function (val) {
                                            var newTitle = val.trim() || '笔记';
                                            if (newTitle === (note.title || '')) return;
                                            loadNotes().then(function (notes) {
                                                var duplicate = notes.some(function (n, i) {
                                                    return i !== index && (n.title || '') === newTitle;
                                                });
                                                if (duplicate) {
                                                    if (typeof showToast === 'function') {
                                                        showToast('已存在同名笔记');
                                                    } else {
                                                        alert('已存在同名笔记');
                                                    }
                                                    return;
                                                }
                                                var oldTitle = note.title || '未命名';
                                                renameNoteFile(oldTitle, newTitle);
                                                notes[index].title = newTitle;
                                                return saveNotes(notes, index).then(function () {
                                                    return loadNotes();
                                                });
                                            }).then(function (notes) {
                                                if (notes) renderNoteList(notes);
                                            });
                                        }
                                    }).show();
                                }
                            } else if (item.value === 'delete') {
                                if (confirm('确定删除笔记"' + (note.title || '无标题') + '"吗？')) {
                                    deleteNoteFile(note.title || '未命名');
                                    loadNotes().then(function (notes) {
                                        // 按标题重新查找索引，因为loadNotes可能返回新数组
                                        var delIdx = -1;
                                        for (var i = 0; i < notes.length; i++) {
                                            if ((notes[i].title || '未命名') === (note.title || '未命名')) {
                                                delIdx = i;
                                                break;
                                            }
                                        }
                                        if (delIdx >= 0) notes.splice(delIdx, 1);
                                        return saveNotes(notes);
                                    }).then(function () {
                                        return loadNotes();
                                    }).then(function (notes) {
                                        renderNoteList(notes);
                                    });
                                }
                            }
                        }
                    }).show();
                } else {
                    if (confirm('确定删除笔记"' + (note.title || '无标题') + '"吗？')) {
                        deleteNoteFile(note.title || '未命名');
                        loadNotes().then(function (notes) {
                            var delIdx = -1;
                            for (var i = 0; i < notes.length; i++) {
                                if ((notes[i].title || '未命名') === (note.title || '未命名')) {
                                    delIdx = i;
                                    break;
                                }
                            }
                            if (delIdx >= 0) notes.splice(delIdx, 1);
                            return saveNotes(notes);
                        }).then(function () {
                            return loadNotes();
                        }).then(function (notes) {
                            renderNoteList(notes);
                        });
                    }
                }
            });
            noteDiv.appendChild(menuBtn);

            notebookList.appendChild(noteDiv);
        });
    }

    // ---------- 批量选择模式 ----------

    function enterBatchMode(initialTitle) {
        batchMode = true;
        batchSelected.clear();
        if (typeof initialTitle === 'string' && initialTitle) {
            batchSelected.add(initialTitle);
        }
        // 更新所有笔记项样式：已选中加 .active，未选中用虚线
        var noteItems = notebookList.querySelectorAll('.agent-item');
        noteItems.forEach(function (el) {
            var t = el.dataset.noteTitle;
            if (batchSelected.has(t)) {
                el.classList.add('active');
                el.style.border = '';
            } else {
                el.classList.remove('active');
                el.style.border = '1px dashed var(--border-color)';
            }
        });
        // 隐藏新增按钮
        if (addNoteBtn) addNoteBtn.style.display = 'none';
        // 底部按钮变为“删除”
        updateBatchFooter();
        if (typeof showToast === 'function') {
            showToast('已进入批量管理，点击选择笔记');
        }
    }

    function exitBatchMode() {
        batchMode = false;
        batchSelected.clear();
        // 恢复笔记项样式
        var noteItems = notebookList.querySelectorAll('.agent-item');
        noteItems.forEach(function (el) {
            el.style.border = '';
        });
        // 恢复新增按钮
        if (addNoteBtn) addNoteBtn.style.display = '';
        // 恢复底部按钮
        if (notebookGetBtn) {
            notebookGetBtn.textContent = '获取电脑端笔记';
            notebookGetBtn.style.color = '';
            notebookGetBtn.style.borderColor = '';
        }
        // 重新渲染列表恢复置顶状态
        loadNotes().then(function (notes) { renderNoteList(notes); });
    }

    function toggleBatchSelect(title) {
        if (batchSelected.has(title)) {
            batchSelected.delete(title);
        } else {
            batchSelected.add(title);
        }
        // 更新该项样式：复用 .active 实线 + 内联虚线
        var el = notebookList.querySelector('.agent-item[data-note-title="' + CSS.escape(title) + '"]');
        if (el) {
            if (batchSelected.has(title)) {
                el.classList.add('active');
                el.style.border = '';
            } else {
                el.classList.remove('active');
                el.style.border = '1px dashed var(--border-color)';
            }
        }
        updateBatchFooter();
    }

    function updateBatchFooter() {
        if (!notebookGetBtn) return;
        var count = batchSelected.size;
        if (batchMode) {
            notebookGetBtn.textContent = count > 0 ? '删除（' + count + '）' : '删除';
            notebookGetBtn.style.color = '#f44336';
            notebookGetBtn.style.borderColor = '#f44336';
        } else {
            notebookGetBtn.textContent = '获取电脑端笔记';
            notebookGetBtn.style.color = '';
            notebookGetBtn.style.borderColor = '';
        }
    }

    function batchDeleteSelected() {
        if (batchSelected.size === 0) {
            if (typeof showToast === 'function') showToast('请先选择笔记');
            return;
        }
        if (!confirm('确定删除选中的 ' + batchSelected.size + ' 条笔记吗？')) return;
        loadNotes().then(function (notes) {
            var titlesToDelete = Array.from(batchSelected);
            // 删除本地文件
            titlesToDelete.forEach(function (t) { deleteNoteFile(t); });
            // 从数组中移除匹配 title 的项
            var remaining = notes.filter(function (n) {
                return !batchSelected.has(n.title || '未命名');
            });
            return saveNotes(remaining);
        }).then(function () {
            exitBatchMode();
            return loadNotes();
        }).then(function (notes) {
            renderNoteList(notes);
            if (typeof showToast === 'function') showToast('已删除选中笔记');
        });
    }

    function escapeHtml(text) {
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ---------- 打开列表弹窗 ----------

    function openNotebook() {
        if (!notebookModal) return;
        if (batchMode) exitBatchMode();
        // 每次打开都重置到笔记视图
        _showingSkills = false;
        setActiveTab('notes');
        // 点击笔记时触发权限申请（复用发送消息时的权限弹窗流程）
        if (window.AndroidBridge && window.AndroidBridge.requestAdPermissionNow) {
            window.AndroidBridge.requestAdPermissionNow();
        }
        loadNotes().then(function (notes) {
            renderNoteList(notes);
        });
        if (typeof openModalWithFade === 'function') {
            openModalWithFade(notebookModal);
        } else {
            notebookModal.classList.add('active');
        }
    }

    function closeNotebookModal() {
        if (batchMode) exitBatchMode();
        if (typeof closeModalWithFade === 'function') {
            closeModalWithFade(notebookModal);
        } else if (notebookModal) {
            notebookModal.classList.remove('active');
        }
    }

    function generateUniqueTitle(existingNotes) {
        var base = '新笔记';
        var titles = existingNotes.map(function (n) { return n.title || ''; });
        if (titles.indexOf(base) === -1) return base;
        var i = 2;
        while (titles.indexOf(base + '_' + i) !== -1) { i++; }
        return base + '_' + i;
    }

    // ---------- 渲染笔记内容为 Markdown ----------

    function renderNoteContent(content, isMd) {
        if (!contentDiv) return;
        if (content && typeof formatMessage === 'function') {
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = formatMessage(content);
        } else if (content) {
            contentDiv.className = '';
            contentDiv.innerHTML = '<pre style="white-space:pre-wrap;word-wrap:break-word;margin:0;font-family:inherit;">' + escapeHtml(content) + '</pre>';
        } else {
            contentDiv.className = '';
            contentDiv.innerHTML = '<p style="color:var(--text-secondary);opacity:0.5;">点击此处输入笔记内容...</p>';
        }
    }

    // ---------- 打开编辑弹窗 ----------

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function openEditView(note, index) {
        editingIndex = index;
        noteModified = 0;
        var autoTitle = note ? (note.title || '新笔记') : '新笔记';
        editingTitle = autoTitle;
        textarea.value = note ? (note.content || '') : '';
        // 渲染内容到展示区（.md 渲染 Markdown，.txt 纯文本）
        renderNoteContent(textarea.value, note ? note.isMd : true);
        var displayTitle = index === -1 ? autoTitle : (note.title || '编辑笔记');
        var timeStr = '';
        if (note && note.time) {
            var d = new Date(note.time);
            timeStr = ' -' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
        }
        editTitle.innerHTML = escapeHtml(displayTitle) + '<span style="font-size:12px;color:var(--text-secondary);font-weight:normal;">' + escapeHtml(timeStr) + '</span>';

        // 点击内容区域弹出底部输入面板
        if (!window._notebookBound && typeof createBottomSheetInput === 'function') {
            window._notebookBound = true;
            if (contentDiv) {
                contentDiv.addEventListener('click', function () {
                    createBottomSheetInput({
                        title: '笔记内容',
                        placeholder: '在此输入笔记内容...',
                        value: textarea.value,
                        inputType: 'textarea',
                        confirmText: '确定',
                        onConfirm: function (val) {
                            textarea.value = val;
                            noteModified = 1;
                            // 新编辑的内容按 Markdown 渲染
                            renderNoteContent(val, true);
                            autoSaveCurrentNote();
                        }
                    }).show();
                });
            }
        }

        // 从列表弹窗切换到编辑弹窗
        if (typeof openModalWithFade === 'function') {
            openModalWithFade(notebookEditModal);
        } else if (notebookEditModal) {
            notebookEditModal.classList.add('active');
        }

        // 自动保存
        autoSaveCurrentNote();
    }

    function closeEditModal() {
        // 只有修改了才保存
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        if (noteModified) {
        var title = editingTitle || '笔记';
        var content = textarea.value;
        if (title !== '笔记' || content) {
            loadNotes().then(function (notes) {
                // 按标题查找已有笔记
                var foundIdx = -1;
                for (var i = 0; i < notes.length; i++) {
                    if ((notes[i].title || '') === title) {
                        foundIdx = i;
                        break;
                    }
                }
                if (foundIdx >= 0) {
                    // 更新已有笔记
                    notes[foundIdx].content = content;
                    notes[foundIdx].time = Date.now();
                } else {
                    // 新增笔记
                    notes.push({ title: title, content: content, time: Date.now() });
                    foundIdx = notes.length - 1;
                }
                return saveNotes(notes, foundIdx);
            }).then(function () {
                return loadNotes();
            }).then(function (notes) {
                renderNoteList(notes);
            });
        }
        }
        if (typeof closeModalWithFade === 'function') {
            closeModalWithFade(notebookEditModal);
        } else if (notebookEditModal) {
            notebookEditModal.classList.remove('active');
        }
    }

    // ---------- 自动保存 ----------

    var autoSaveTimer = null;

    function autoSaveCurrentNote() {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(function () {
            var title = editingTitle || '笔记';
            var content = textarea.value;
            loadNotes().then(function (notes) {
                // 按标题查找已有笔记
                var foundIdx = -1;
                for (var i = 0; i < notes.length; i++) {
                    if ((notes[i].title || '') === title) {
                        foundIdx = i;
                        break;
                    }
                }
                if (foundIdx >= 0) {
                    notes[foundIdx].content = content;
                    notes[foundIdx].time = Date.now();
                } else {
                    notes.push({ title: title, content: content, time: Date.now() });
                    foundIdx = notes.length - 1;
                }
                return saveNotes(notes, foundIdx);
            });
        }, 500);
    }

    // ---------- 连接检查 ----------

    function checkPCConnection() {
        if (!pcConnection || !pcConnection.connected || !pcConnection.authenticated) {
            alert('未连接到电脑，请先连接并配对电脑端');
            return false;
        }
        return true;
    }

    // ---------- 获取电脑端笔记 ----------

    function getPCNotebook() {
        if (!confirm('确定要从电脑端获取笔记吗？')) return;
        if (!checkPCConnection()) return;

        var id = 'nb_get_' + Date.now();

        var timeout = setTimeout(function () {
            if (pcConnection.ws) pcConnection.ws.removeEventListener('message', handler);
            alert('获取失败: 请求超时');
        }, 10000);

        var handler = function (e) {
            try {
                var msg = JSON.parse(e.data);
                if (msg.type === 'notebook_get_result') {
                    clearTimeout(timeout);
                    if (pcConnection.ws) pcConnection.ws.removeEventListener('message', handler);
                    if (msg.success) {
                        var pcContent = msg.content || '';
                        loadNotes().then(function (notes) {
                            var now = new Date();
                        var pcTitle = '电脑端笔记_' + now.getFullYear() + '_' + pad2(now.getMonth()+1) + pad2(now.getDate()) + '_' + pad2(now.getHours()) + '_' + pad2(now.getMinutes()) + '_' + pad2(now.getSeconds());
                        notes.push({ title: pcTitle, content: pcContent, time: Date.now() });
                            return saveNotes(notes, notes.length - 1);
                        }).then(function () {
                            return loadNotes();
                        }).then(function (notes) {
                            renderNoteList(notes);
                            showToast('已获取电脑端笔记');
                        });
                    } else {
                        alert('获取失败: ' + (msg.error || '未知错误'));
                    }
                }
            } catch (_) {}
        };

        if (pcConnection.ws) pcConnection.ws.addEventListener('message', handler);
        pcConnection.send({ type: 'notebook_get', id: id });
    }

    // ---------- 同步当前笔记到电脑 ----------

    function syncCurrentToPC() {
        if (!confirm('确定要将当前笔记同步到电脑端吗？')) return;
        if (!checkPCConnection()) return;

        var title = editingTitle || '笔记';
        var content = textarea.value;

        loadNotes().then(function (notes) {
            if (editingIndex === -1) {
                notes.push({ title: title, content: content, time: Date.now() });
                editingIndex = notes.length - 1;
            } else {
                notes[editingIndex].title = title;
                notes[editingIndex].content = content;
                notes[editingIndex].time = Date.now();
            }
            return saveNotes(notes, editingIndex);
        }).then(function () {
            var id = 'nb_sync_' + Date.now();

            var timeout = setTimeout(function () {
                if (pcConnection.ws) pcConnection.ws.removeEventListener('message', handler);
                alert('同步失败: 请求超时');
            }, 10000);

            var handler = function (e) {
                try {
                    var msg = JSON.parse(e.data);
                    if (msg.type === 'notebook_sync_result') {
                        clearTimeout(timeout);
                        if (pcConnection.ws) pcConnection.ws.removeEventListener('message', handler);
                        if (msg.success) {
                            showToast('已同步到电脑端');
                        } else {
                            alert('同步失败: ' + (msg.error || '未知错误'));
                        }
                    }
                } catch (_) {}
            };

            if (pcConnection.ws) pcConnection.ws.addEventListener('message', handler);
            pcConnection.send({ type: 'notebook_sync', id: id, content: '## ' + title + '\n' + content });
        });
    }

    // ---------- 绑定事件 ----------

    if (notebookOpenBtn) {
        notebookOpenBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            openNotebook();
        });
    }

    if (closeNotebook) closeNotebook.addEventListener('click', closeNotebookModal);
    if (closeNotebookEdit) closeNotebookEdit.addEventListener('click', closeEditModal);

    if (addNoteBtn) addNoteBtn.addEventListener('click', function () {
    loadNotes().then(function (notes) {
        var title = generateUniqueTitle(notes);
        openEditView({ title: title, content: '' }, -1);
    });
});

    if (notebookGetBtn) notebookGetBtn.addEventListener('click', function () {
        if (batchMode) {
            batchDeleteSelected();
        } else {
            getPCNotebook();
        }
    });
    if (editSyncBtn) editSyncBtn.addEventListener('click', syncCurrentToPC);

    // 编辑视图自动保存
    if (textarea) textarea.addEventListener('change', autoSaveCurrentNote);

    // 点击遮罩关闭
    if (notebookModal) {
        notebookModal.addEventListener('click', function (e) {
            if (e.target === notebookModal) closeNotebookModal();
        });
    }
    if (notebookEditModal) {
        notebookEditModal.addEventListener('click', function (e) {
            if (e.target === notebookEditModal) closeEditModal();
        });
    }

    // ---------- 笔记/Skills 标签切换 ----------

    var notesTabBtn = document.getElementById('notesTabBtn');
    var skillsTabBtn = document.getElementById('skillsTabBtn');
    var _showingSkills = false;

    function setActiveTab(tab) {
        if (notesTabBtn) {
            notesTabBtn.classList.toggle('tab-btn-active', tab === 'notes');
        }
        if (skillsTabBtn) {
            skillsTabBtn.classList.toggle('tab-btn-active', tab === 'skills');
        }
    }

    function switchToNotes() {
        if (!_showingSkills) return;
        _showingSkills = false;
        setActiveTab('notes');
        if (!notebookList) return;

        // 清空并重新渲染笔记列表
        notebookList.innerHTML = '';
        // 重新添加新增按钮
        var addBtn = document.createElement('button');
        addBtn.className = 'dashed-add-btn';
        addBtn.id = 'addNoteBtn';
        addBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg><span>新增笔记</span>';
        addBtn.addEventListener('click', function () {
            loadNotes().then(function (notes) {
                var title = generateUniqueTitle(notes);
                openEditView({ title: title, content: '' }, -1);
            });
        });
        notebookList.appendChild(addBtn);

        // 恢复笔记列表
        loadNotes().then(function (notes) {
            renderNoteList(notes);
        });

        // 恢复底部按钮
        var getBtn = document.getElementById('notebookGetBtn');
        if (getBtn) getBtn.style.display = '';
    }

    function renderSkillsList() {
        _showingSkills = true;
        setActiveTab('skills');
        if (!notebookList) return;

        // 隐藏底部按钮
        var getBtn = document.getElementById('notebookGetBtn');
        if (getBtn) getBtn.style.display = 'none';

        // 清空列表，显示加载中
        notebookList.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-secondary,#888);font-size:14px;">正在加载 Skills...</div>';

        if (!window.AndroidBridge || typeof window.AndroidBridge.scanSkillsDir !== 'function') {
            notebookList.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-secondary,#888);font-size:14px;">当前版本不支持 Skills</div>';
            return;
        }

        try {
            var json = window.AndroidBridge.scanSkillsDir();
            var skillNames = JSON.parse(json);

            // 清空列表（去掉加载中提示）
            notebookList.innerHTML = '';

            if (!skillNames || skillNames.length === 0) {
                notebookList.innerHTML = '<div style="padding:32px 16px;text-align:center;color:var(--text-secondary,#888);font-size:14px;">暂无 Skill<br><span style="font-size:12px;">请将 skill 放入 Downloads/Bluox/Skills/ 目录</span></div>';
                return;
            }

            for (var i = 0; i < skillNames.length; i++) {
                var name = skillNames[i];
                var skillMd = window.AndroidBridge.readSkillFile(name);
                var hasExecutor = skillMd && skillMd.indexOf('runtime:') !== -1;
                var displayName = name;
                var desc = '';

                if (skillMd) {
                    var nameMatch = skillMd.match(/^name:\s*(\S+)/m);
                    if (nameMatch) displayName = nameMatch[1];
                    var descMatch = skillMd.match(/^description:\s*(.+)/m);
                    if (descMatch) {
                        desc = descMatch[1].trim();
                        if (desc.length > 60) desc = desc.substring(0, 60) + '...';
                    }
                }

                var tag = hasExecutor
                    ? '<span style="font-size:10px;color:#4caf50;border:1px solid #4caf50;border-radius:2px;padding:0 4px;margin-left:6px;line-height:1.4;display:inline-block;">可执行</span>'
                    : '<span style="font-size:10px;color:#ff9800;border:1px solid #ff9800;border-radius:2px;padding:0 4px;margin-left:6px;line-height:1.4;display:inline-block;">参考</span>';

                // 复用 agent-item 样式
                var div = document.createElement('div');
                div.className = 'agent-item';

                var infoDiv = document.createElement('div');
                infoDiv.className = 'agent-item-info';
                infoDiv.innerHTML =
                    '<span class="agent-item-name">' + escapeHtml(displayName) + tag + '</span>' +
                    (desc ? '<span class="agent-item-desc">' + escapeHtml(desc) + '</span>' : '');
                div.appendChild(infoDiv);

                // 点击打开 SKILL.md 内容
                div.addEventListener('click', function (n, md) {
                    return function () {
                        if (md) {
                            var body = md.replace(/^---[\s\S]*?---\n?/, '').trim();
                            if (!body) body = md;
                            if (typeof openModalWithFade === 'function') {
                                var previewModal = document.getElementById('notebookEditModal');
                                if (previewModal) {
                                    var titleEl = document.getElementById('notebookEditTitle');
                                    if (titleEl) titleEl.textContent = 'Skill: ' + n;
                                    var contentEl = document.getElementById('notebookContent');
                                    if (contentEl) {
                                        contentEl.innerHTML = '<pre style="white-space:pre-wrap;font-size:13px;line-height:1.6;margin:0;">' + escapeHtml(body) + '</pre>';
                                    }
                                    var textareaEl = document.getElementById('notebookTextarea');
                                    if (textareaEl) textareaEl.style.display = 'none';
                                    var syncBtn = document.getElementById('notebookEditSyncBtn');
                                    if (syncBtn) syncBtn.style.display = 'none';
                                    openModalWithFade(previewModal);
                                }
                            }
                        }
                    };
                }(displayName, skillMd));

                notebookList.appendChild(div);
            }
        } catch (e) {
            notebookList.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-secondary,#888);">加载失败: ' + escapeHtml(e.message) + '</div>';
        }
    }

    // 笔记按钮点击
    if (notesTabBtn) {
        notesTabBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            switchToNotes();
        });
    }

    // Skills 按钮点击
    if (skillsTabBtn) {
        skillsTabBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (_showingSkills) {
                switchToNotes();
            } else {
                renderSkillsList();
            }
        });
    }

    // 暴露给外部调用
    window.closeNotebookEditModal = closeEditModal;
    window.switchToSkills = switchToSkills;
    window.switchToNotes = switchToNotes;
})();