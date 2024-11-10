import {trpc} from '@/trpc/client';
import {useParams} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {CommentInterface} from './types';

function ActualInputBox({
    setClicked,
    refetch,
    optimisticSetter,
}: {
    setClicked: (x: boolean) => void;
    refetch: () => void;
    optimisticSetter: (x: CommentInterface) => void;
}) {
    const [textInput, setTextInput] = useState('');

    const {id: petition_id} = useParams<{id: string}>();

    const createCommentMutation = trpc.comments.create.useMutation();

    const createComment = async () => {
        const comment = await createCommentMutation.mutateAsync({
            petition_id: petition_id,
            body: textInput,
        });

        setTextInput('');
        setClicked(false);

        if (comment.data) {
            optimisticSetter({
                id: comment.data.id!!,
                total_votes: 0,
                created_by: comment.data.created_by!!,
                body: comment.data.body!!,
                deleted_at: null,
                highlighted_at: null,
                username: comment.data.username!!,
                user_vote: 0,
                profile_picture: comment.data.profile_picture,
            });
        }
    };

    const commentBoxRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        commentBoxRef.current?.focus();
    }, []);

    return (
        <div className="w-full border bg-white rounded-lg">
            <textarea
                className="w-full p-4 rounded-lg focus:border-black focus:outline-none"
                value={textInput}
                onChange={(e) => {
                    setTextInput(e.target.value);
                }}
                ref={commentBoxRef}
            />
            <div className="flex gap-2 justify-end p-2">
                <p
                    className="p-2 border bg-none rounded-full text-sm cursor-pointer px-4"
                    onClick={() => {
                        setClicked(false);
                    }}>
                    Cancel
                </p>
                <p
                    className="p-2 border bg-green-600 text-white rounded-full text-sm cursor-pointer px-4"
                    onClick={() => {
                        createComment();
                    }}>
                    Comment
                </p>
            </div>
        </div>
    );
}

export function FakeInputBox() {
    return (
        <div className="border rounded-full w-full p-3 my-4 cursor-pointer">
            Add a comment
        </div>
    );
}

export default function RootInputBox({
    refetch,
    optimisticSetter,
}: {
    refetch: () => void;
    optimisticSetter: (x: CommentInterface) => void;
}) {
    const [clicked, setClicked] = useState(false);

    return (
        <>
            {clicked ? (
                <ActualInputBox
                    setClicked={setClicked}
                    refetch={refetch}
                    optimisticSetter={optimisticSetter}
                />
            ) : (
                <div
                    onClick={() => {
                        setClicked(true);
                    }}>
                    <FakeInputBox />
                </div>
            )}
        </>
    );
}
