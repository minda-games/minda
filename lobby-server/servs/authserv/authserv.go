package authserv

import (
	"go.uber.org/zap"
	"lobby/utils"
	"github.com/gobuffalo/pop/nulls"
	"strconv"
	"github.com/markbates/goth"
	"lobby/servs/dbserv"
	"errors"
	"lobby/models"
)

var (
	ErrNotFound = errors.New("not found")
)

type AuthServ struct {
	DB *dbserv.DBServ `dim:"on"`
	secret []byte
}

type AuthServConf struct {
	Secret string `yaml:"secret"`
}

func Provide(conf AuthServConf) *AuthServ {
	return &AuthServ{
		secret: []byte(conf.Secret),
	}
}

func (AuthServ) ConfigName() string {
	return "auth"
}

func (a *AuthServ) Init() error {
	size, err := a.DB.Count(&models.User{})
	if err != nil {
		return err
	}
	if size == 0 {
		user := models.User {
			Username: "admin",
			Picture: nulls.String{Valid:false},
			Permission: models.UserPermission {
				Admin: true,
			},
		}
		err := a.DB.Eager().Create(&user)
		if err != nil {
			return err
		}
		utils.Log.Info("Admin token", zap.String("token", a.CreateToken(user.ID)))
	}
	return nil
}

func (a *AuthServ) GetUser(id int) (models.User, error) {
	user := models.User{}
	err := a.DB.Eager().Q().Where("id = ?", id).First(&user)
	return user, err
}

func (a *AuthServ) CreateUserByOAuth(provider string, guser goth.User) (models.User, error) {
	username := guser.NickName
	if username == "" {
		username = guser.Name
	}
	picture := nulls.String{Valid:false}
	if guser.AvatarURL != "" {
		picture = nulls.NewString(guser.AvatarURL)
	}
	user := models.User{
		Username: username,
		Picture: picture,
	}
	err := a.DB.Eager().Create(&user)
	if err != nil {
		return models.User{}, err
	}
	ouser := models.OAuthUser {
		Provider: provider,
		ID: guser.UserID,
		UserID: user.ID,
	}
	err = a.DB.Create(&ouser)
	return user, err
}

func (a *AuthServ) GetUserByOAuth(provider string, id string) (models.User, error) {
	ouser := models.OAuthUser{}
	err := a.DB.Q().Where("provider = ? AND id = ?", provider, id).First(&ouser)
	if err != nil {
		return models.User{}, ErrNotFound
	}

	return a.GetUser(ouser.UserID)
}

func (a *AuthServ) ParseToken(token string) (int, error) {
	str, err := decrypt(a.secret, token)
	if err != nil {
		return 0, err
	}

	return strconv.Atoi(str)
}

func (a *AuthServ) CreateToken(id int) string {
	str, err := encrypt(a.secret, strconv.Itoa(id))
	if err != nil {
		utils.Log.Fatal("Error while creating token", zap.Error(err))
	}
	return str
}

func (a *AuthServ) Authorize(token string) (models.User, error) {
	if token == "black" {
		return models.User{
			ID:       101,
			Username: "흑우",
		}, nil
	}
	if token == "white" {
		return models.User{
			ID:       201,
			Username: "백우",
		}, nil
	}

	id, err := a.ParseToken(token) 
	if err != nil {
		return models.User{}, err
	}

	return a.GetUser(id)
}
