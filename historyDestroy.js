/**
 * Summaryception History Destroy Module
 *
 * Handles destroying the first N messages and recalculating Summaryception indexes,
 * promoting affected L0 summaries to L1.
 *
 * AGPL-3.0
 */

function adjustStoreForHistoryDestroy(store, N) {
    if (!store.layers[0]) store.layers[0] = [];

    const toPromote = [];
    const toKeep = [];

    for (const sn of store.layers[0]) {
        if (!sn.turnRange || sn.turnRange[0] < N) {
            toPromote.push(sn);
        } else {
            toKeep.push(sn);
        }
    }

    if (toPromote.length > 0) {
        if (!store.layers[1]) store.layers[1] = [];
        for (const sn of toPromote) {
            const promoted = { ...sn };
            delete promoted.turnRange;
            promoted.promoted = true;
            promoted.seedFromLayer = 0;
            store.layers[1].push(promoted);
        }
    }

    for (const sn of toKeep) {
        if (sn.turnRange) {
            sn.turnRange[0] -= N;
            sn.turnRange[1] -= N;
        }
    }

    store.layers[0] = toKeep;

    if (toKeep.length > 0) {
        store.summarizedUpTo = Math.max(
            ...toKeep.filter(sn => sn.turnRange).map(sn => sn.turnRange[1])
        );
    } else {
        store.summarizedUpTo = -1;
    }

    store.ghostedIndices = (store.ghostedIndices || [])
        .map(i => i - N)
        .filter(i => i >= 0);
}

export function initHistoryDestroy(deps) {
    const {
        getChatStore,
        isPresenceGroupMode,
        getGroupMembers,
        getMemberStore,
        unghostAllMessages,
        saveChatStore,
        ghostMessagesUpTo,
        updateInjection,
        updateUI,
        log,
    } = deps;

    try {
        const {
            SlashCommandParser,
            SlashCommand,
            SlashCommandArgument,
            ARGUMENT_TYPE,
        } = SillyTavern.getContext();

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'sc-history-destroy',
            callback: async (args, rawN) => {
                const N = parseInt(rawN);
                const stCtx = SillyTavern.getContext();
                const { chat } = stCtx;

                if (isNaN(N) || N <= 0) return 'Error: provide a positive number. Usage: /sc-history-destroy 200';
                if (N >= chat.length) return `Error: chat only has ${chat.length} messages.`;

                const rootStore = getChatStore();
                const checks = [];

                if (isPresenceGroupMode()) {
                    const members = getGroupMembers();
                    for (const member of members) {
                        const ms = getMemberStore(member.avatar);
                        if (ms && ms.summarizedUpTo >= 0 && N > ms.summarizedUpTo + 1) {
                            checks.push(`  ${member.name} (summarized: ${ms.summarizedUpTo})`);
                        }
                    }
                } else {
                    if (rootStore.summarizedUpTo >= 0 && N > rootStore.summarizedUpTo + 1) {
                        checks.push(`  Root store (summarized: ${rootStore.summarizedUpTo})`);
                    }
                }

                const warnMsg = checks.length > 0
                    ? `\n\nWarning: Some stores have not summarized up to ${N}:\n${checks.join('\n')}\nUnsummarized messages will be lost for those.`
                    : '';

                if (!confirm(`WARNING: Destroy the first ${N} messages from chat history?\nSummaries will be preserved by promoting L0 snippets to L1.${warnMsg}`)) {
                    return 'History destroy cancelled.';
                }

                await unghostAllMessages();

                if (isPresenceGroupMode()) {
                    adjustStoreForHistoryDestroy(rootStore, N);
                    const members = getGroupMembers();
                    for (const member of members) {
                        const ms = getMemberStore(member.avatar);
                        if (ms) adjustStoreForHistoryDestroy(ms, N);
                    }
                } else {
                    adjustStoreForHistoryDestroy(rootStore, N);
                }

                chat.splice(0, N);

                await saveChatStore();
                try { if (stCtx.saveChat) await stCtx.saveChat(); } catch (e) { log('Save error:', e); }

                await stCtx.reloadCurrentChat();

                const storeAfter = getChatStore();
                if (!isPresenceGroupMode() && storeAfter.summarizedUpTo >= 0) {
                    await ghostMessagesUpTo(storeAfter.summarizedUpTo);
                }

                updateInjection();
                updateUI();

                const freshChat = SillyTavern.getContext().chat;
                return `Destroyed first ${N} messages. Chat now has ${freshChat.length} messages.`;
            },
            helpString: 'Destroy the first N messages from chat history. Summaries are preserved by promoting L0 to L1.',
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'Number of messages to destroy from the beginning',
                    typeList: [ARGUMENT_TYPE.NUMBER],
                    required: true,
                }),
            ],
        }));
    } catch (e) {
        log('Could not register /sc-history-destroy slash command:', e);
    }
}
