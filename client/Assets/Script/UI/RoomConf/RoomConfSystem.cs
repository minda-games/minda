﻿using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using Game;
using Models;
using Network;
using Utils;

namespace UI
{
    public class RoomConfSystem : MonoBehaviour
    {
        //player2 가 본인
        [SerializeField]
        private UserList userList;
        [SerializeField]
        private PlayerInfoDisplay player1InfoDisplay;
        [SerializeField]
        private PlayerInfoDisplay player2InfoDisplay;
        [SerializeField]
        private StartBtn startBtn;

        [SerializeField]
        private IntUpDown defeatLostMarble;
        [SerializeField]
        private IntUpDown turnTimeout;
        [SerializeField]
        private IntUpDown gameTimeout;

        
        private void Awake()
        {
            GameServer.instance.UserEnteredEvent += UserEnter;
            GameServer.instance.UserLeftEvent += UserLeft;
            GameServer.instance.ConfedEvent += ConfedCallBack;

            defeatLostMarble.ValueChanged += DefeatLostMarbleValueChanged;
            turnTimeout.ValueChanged += TurnTimeoutValueChanged;
            gameTimeout.ValueChanged += GameTimeoutValueChanged;
        }
        
        private void DefeatLostMarbleValueChanged(int value)
        {
            GameServer.instance.connectedRoom.conf.game_rule.defeat_lost_stones = value;
            GameServer.instance.UpdateConf();
        }
        private void TurnTimeoutValueChanged(int value)
        {
            GameServer.instance.connectedRoom.conf.game_rule.turn_timeout = value;
            GameServer.instance.UpdateConf();
        }
        private void GameTimeoutValueChanged(int value)
        {
            Debug.Log(value*60);
            turnTimeout.ChangeMax(value*60);
            GameServer.instance.connectedRoom.conf.game_rule.game_timeout = value*60;
            GameServer.instance.UpdateConf();
        }

        private void Start()
        {
            UpdateAllConf();
        }

        private void OnDestroy()
        {
            GameServer.instance.UserEnteredEvent -= UserEnter;
            GameServer.instance.UserLeftEvent -= UserLeft;
            GameServer.instance.ConfedEvent -= ConfedCallBack;
        }

        private void UserEnter(int id, BallType ballType)
        {
            UpdateAllConf();
        }

        
        private void UserLeft(int user)
        {
            UpdateAllConf();
        }

        private void ConfedCallBack(Conf conf)
        {
            UpdateAllConf();
        }

        private void SetPlayerInfo(Conf conf)
        {
            var isSpectator = GameServer.instance.isSpectator;
            var me = LobbyServer.instance.loginUser;

            int player2Id;
            int player1Id;

            if(isSpectator)
            {
                player2Id = conf.black;
                player1Id = conf.white;
            }
            else
            {
                player2Id = me.id;
                player1Id = GetOpponentId(me.id);
            }

            if(player1Id == -1 && player2Id == -1)
            {
                player1InfoDisplay.display(-1, BallType.White);
                player2InfoDisplay.display(-1, BallType.Black);
                return;
            }

            if(player1Id == -1)
            {
                player1InfoDisplay.display(-1, RoomUtils.GetBallType(-1));
            }
            else
            {
                player1InfoDisplay.display(player1Id, RoomUtils.GetBallType(player1Id));
            }

            if (player2Id == -1)
            {
                player2InfoDisplay.display(-1, RoomUtils.GetBallType(-1));
            }
            else
            {
                player2InfoDisplay.display(player2Id, RoomUtils.GetBallType(player2Id));
            }

            if (conf.king == me.id && conf.black != -1 && conf.white != -1)
            {
                startBtn.Active();
            } 
            else 
            {
                startBtn.UnActive();
            }
        }

        private void UpdateAllConf()
        {
            var room = GameServer.instance.connectedRoom;
            if (room != null) 
            {
                SetPlayerInfo(room.conf);
                userList.Load(room.Users.ToArray());
                //맵에서의 흰돌과 흑돌 각각 갯수 중 작은 값
                var max = Mathf.Min(StringUtils.ParticularCharCount(room.conf.map, '1'), StringUtils.ParticularCharCount(room.conf.map, '2'));
                defeatLostMarble.ChangeMax(max);
            }
        }

        private int GetOpponentId(int myId)
        {
            var room = GameServer.instance.connectedRoom;
            if (myId == room.conf.black)
            {
                return room.conf.white;
            }
            else
            {
                return room.conf.black;
            }
        }

    }
}